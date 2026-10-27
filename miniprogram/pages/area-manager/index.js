const areaAdminApi = require('../../api/area-admin');
const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');
const scanContext = require('../../utils/scan-context');
const orderApi = require('../../api/order');
const STATUS = require('../../constants/order-status');
const { ROLE } = require('../../constants/role');
const printerService = require('../../services/printer-service').default;
const { PRINT_CANVAS_SIZE } = require('../../services/printer-service');
const HISTORY_INTERNAL_STAGES = [
  'CREATED', 'DEPOSIT_CONFIRMED', 'GARMENT_RECEIVED', 'DELIVERED_TO_LAUNDRY',
  'PRICE_FINAL_CONFIRMED', 'WASH_FINISHED', 'RETURN_CONFIRMED',
  'PAYMENT_CONFIRMED', 'USER_PICKUP_CONFIRMED', 'CANCELLED',
  'CANCELLED_WAITING_USER_PICKUP', 'CANCELLED_WAITING_RETURN',
  'REWASH_APPROVED', 'EXCEPTION',
];

const STATUS_LABEL = {
  PENDING_DEPOSIT: '待存衣',
  WAITING_PICKUP: '待取货',
  WASHING: '洗护中',
  WAITING_RETURN: '待返柜',
  WAITING_PAYMENT_PICKUP: '待取衣',
  CANCELLED: '已取消',
  REWASHING: '返洗中',
  EXCEPTION: '异常待处理',
  [STATUS.CREATED]:        '待洗护',
  [STATUS.CLEANING]:       '洗护中',
  [STATUS.READY]:          '待取衣',
  [STATUS.COMPLETED]:      '已完成',
  [STATUS.PENDING_PICKUP]: '待管理员取',
};


function enrichOrder(raw) {
  const items = raw.items || raw.laundryOrderItems || [];
  const returnCabinet = raw.returnCabinet || {};
  const returnCompartment = raw.returnCompartment || {};
  const operationCabinetId = raw.depositCabinetId ?? raw.returnCabinetId
    ?? returnCabinet.id ?? raw.cabinetId ?? '';
  const operationCabinetName = raw.depositCabinetName || raw.cabinetName
    || raw.returnCabinetName || returnCabinet.cabinetName || returnCabinet.name || '';
  return {
    ...raw,
    id: String(raw.id ?? raw.orderId ?? ''),
    orderNo: String(raw.orderNo || ''),
    status: raw.orderStatus || raw.status || '',
    cabinetType: String(raw.cabinetType || raw.requestedDepositSize || 'small').toLowerCase(),
    statusLabel: STATUS_LABEL[raw.orderStatus || raw.status] || raw.orderStatus || raw.status,
    customerName: raw.userName || raw.customerName || '未填写姓名',
    customerPhone: raw.userPhone || raw.phone || '',
    storeName: raw.storeName || raw.serviceSiteName || '洗衣订单',
    operationCabinetId: String(operationCabinetId),
    operationCabinetName,
    cabinetLabel: raw.returnCabinetName || returnCabinet.cabinetName || returnCabinet.name || raw.cabinetName || raw.depositCabinetName || raw.returnCabinetId || raw.depositCabinetId || '',
    compartmentLabel: raw.returnCompartmentNo || returnCompartment.compartmentNo || returnCompartment.no || raw.compartmentNo || raw.depositCompartmentNo || raw.returnCompartmentId || raw.depositCompartmentId || '',
    items: items.map((item) => ({
      ...item,
      name: item.name || item.categoryName || item.categoryNameSnapshot || '衣物',
      count: item.count ?? item.quantity ?? 1,
    })),
  };
}

function buildCabinetOptions(cabinetSummaries, cabinets) {
  const summaries = Array.isArray(cabinetSummaries) ? cabinetSummaries : [];
  const cabinetIds = (cabinets || []).reduce((map, cabinet) => {
    if (cabinet.name && cabinet.id !== undefined && cabinet.id !== null) {
      map[cabinet.name] = String(cabinet.id);
    }
    return map;
  }, {});
  const totalCount = summaries.reduce((sum, item) => sum + (Number(item.orderCount) || 0), 0);
  const allOption = {
    id: '',
    cabinetId: '',
    name: '全部柜机',
    displayName: `全部柜机（${totalCount} 单）`,
    orderCount: totalCount,
  };
  const sortedOptions = summaries
    .filter(item => item && item.cabinetName)
    .map(item => ({
      id: cabinetIds[item.cabinetName] || `name:${item.cabinetName}`,
      cabinetId: cabinetIds[item.cabinetName] || '',
      name: item.cabinetName,
      orderCount: Number(item.orderCount) || 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .map(option => ({ ...option, displayName: `${option.name}（${option.orderCount} 单）` }));
  return [allOption, ...sortedOptions];
}

function filterOrdersByCabinet(orders, option) {
  if (!option || !option.id) return orders;
  if (option.cabinetId) {
    return orders.filter(order => order.operationCabinetId === option.cabinetId);
  }
  return orders.filter(order => order.operationCabinetName === option.name);
}

Page({
  data: {
    mode: 'pickup',
    stage: 'idle',
    order: null,
    orderList: [],
    allOrderList: [],
    cabinetOptions: [{ id: '', name: '全部柜机', displayName: '全部柜机（0 单）', orderCount: 0 }],
    selectedCabinetIndex: 0,
    selectedCabinetId: '',
    selectedCabinetName: '全部柜机',
    selectedCabinetOrderCount: 0,
    selectedCabinetType: 'small',
    errorMsg: '',
    retrying: false,
    cabinetId: '',
    cabinetName: '',
    entrySource: '',
    loading: false,
    printingOrderId: '',
    printerStatus: 'idle', printerStatusText: '准备连接打印机', printerDeviceName: '', printerError: '', printerDevices: [], printerPrinting: false,
    submitting: false,
    returnOperationId: '',
    returnOpenKey: '',
    returnConfirmKey: '',
  },

  onLoad(options) {
    this.setData({ pixelRatio: wx.getWindowInfo().pixelRatio, templateWidth: PRINT_CANVAS_SIZE.width, templateHeight: PRINT_CANVAS_SIZE.height, barCodeWidth: 214, barCodeHeight: 72, qrCodeWidth: 20, qrCodeHeight: 20 });
    this.canvasText = wx.createCanvasContext('Canvas', this);
    this.canvasBarCode = wx.createSelectorQuery().in(this);
    // 扫描小程序码冷启动时，微信会把 page 参数放在 options.scene；
    // 普通二维码/页面跳转则通常使用 orderId、cabinetId 参数。
    const context = this._parseScanContext(options || {});
    if (context.type === 'order' && context.value) {
      this._openOrderFromScene(context.value);
    } else if (context.type === 'cabinet' && context.value) {
      this.setData({ cabinetId: context.value, cabinetName: context.name || '', entrySource: 'cabinet-code' });
      wx.showToast({ title: '已识别柜机', icon: 'success' });
    }
  },

  onShow() {
    if (!authService.requireRole(ROLE.MANAGER)) return;
    if (!this.printerUnsubscribe) {
      const syncPrinterState = state => {
        const text = { searching: '正在搜索打印机', connecting: `正在连接 ${state.deviceName || '打印机'}`, connected: '打印机已连接', disconnected: '打印机连接断开', idle: '准备连接打印机' }[state.status] || '打印机连接断开';
        this.setData({ printerStatus: state.status, printerStatusText: text, printerDeviceName: state.deviceName || '', printerError: state.error || '', printerDevices: state.devices || [], printerPrinting: !!state.printing });
      };
      syncPrinterState(printerService.getState());
      this.printerUnsubscribe = printerService.subscribe(syncPrinterState);
    }
    if (printerService.getState().status !== 'connected') {
      printerService.startDiscovery({ autoConnect: true }).catch(() => {});
    }
    this._refreshList();
  },

  onHide() {
    // 离开页面时停止纯搜索；连接建立中的流程继续执行，避免被页面切换打断。
    if (printerService.getState().status === 'searching') printerService.stopDiscovery(true);
  },

  async onPullDownRefresh() {
    try {
      await this._refreshList();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  _parseScanContext(options) {
    const decode = (value) => {
      try { return decodeURIComponent(value || ''); } catch (e) { return value || ''; }
    };
    const scene = decode(options.scene || '');
    const source = scene || decode(options.q || '');
    const params = {};
    String(source).split(/[?&]/).forEach((part) => {
      const pair = part.split('=');
      if (pair.length > 1) params[decode(pair[0])] = decode(pair.slice(1).join('='));
    });
    const orderId = options.orderId || params.orderId || (params.type === 'order' ? params.id : '');
    const cabinetId = options.cabinetId || params.cabinetId || (params.type === 'cabinet' ? params.id : '');
    if (orderId) return { type: 'order', value: orderId };
    if (cabinetId) return { type: 'cabinet', value: cabinetId, name: params.name || options.cabinetName };
    return { type: '', value: '' };
  },

  async _openOrderFromScene(orderId) {
    if (!orderId) return;
    if (!authService.requireRole(ROLE.MANAGER)) return;
    try {
      const order = await areaAdminApi.getAreaAdminOrderById(orderId);
      if (!order) throw new Error('订单不存在');
      this._showOrderFound(order);
    } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  setMode(e) {
    if (this.data.stage !== 'idle' || this.data.loading) return;
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      mode,
      selectedCabinetIndex: 0,
      selectedCabinetId: '',
      selectedCabinetName: '全部柜机',
      selectedCabinetOrderCount: 0,
    });
    this._refreshList(mode);
  },

  async _refreshList(mode) {
    const m = mode || this.data.mode;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
        // 后端按 OrderInternalStage 枚举过滤：取货对应已确认存衣，送货对应洗护完成待返柜。
        const internalStage = m === 'delivery' ? 'WASH_FINISHED' : 'DEPOSIT_CONFIRMED';
        const result = await areaAdminApi.getAreaAdminOrders({
          page: 1,
          pageSize: 100,
          internalStage: m === 'history' ? HISTORY_INTERNAL_STAGES : internalStage,
        });
        const records = Array.isArray(result) ? result : (result && result.records) || [];
        const uniqueRecords = [...new Map(records.map((record) => [String(record.id ?? record.orderId), record])).values()];
        const [cabinetSummaries, cabinets] = m === 'history'
          ? [[], []]
          : await Promise.all([
            areaAdminApi.getAreaAdminCabinets(internalStage),
            cabinetService.loadStores().catch(() => []),
          ]);
        const allOrderList = uniqueRecords
          .sort((left, right) => new Date(right.updatedAt || right.updateAt || right.createAt || right.createdAt || 0)
            - new Date(left.updatedAt || left.updateAt || left.createAt || left.createdAt || 0))
          .map(enrichOrder);
        const cabinetOptions = buildCabinetOptions(cabinetSummaries, cabinets);
        const selectedCabinetIndex = cabinetOptions.findIndex(
          option => option.id === this.data.selectedCabinetId
        );
        const activeIndex = selectedCabinetIndex < 0 ? 0 : selectedCabinetIndex;
        const selectedCabinetId = cabinetOptions[activeIndex].id;
        const orderList = filterOrdersByCabinet(allOrderList, cabinetOptions[activeIndex]);
        this.setData({
          allOrderList,
          orderList,
          cabinetOptions,
          selectedCabinetIndex: activeIndex,
          selectedCabinetId,
          selectedCabinetName: cabinetOptions[activeIndex].name,
          selectedCabinetOrderCount: cabinetOptions[activeIndex].orderCount,
          loading: false,
        });
      } catch (error) {
        this.setData({ loading: false });
        wx.showToast({ title: error.message || '订单列表加载失败', icon: 'none' });
      }

  },

  selectOrderCabinet(e) {
    const selectedCabinetIndex = Number(e.detail.value) || 0;
    const option = this.data.cabinetOptions[selectedCabinetIndex] || this.data.cabinetOptions[0];
    const selectedCabinetId = option.id;
    const orderList = filterOrdersByCabinet(this.data.allOrderList, option);
    this.setData({
      selectedCabinetIndex,
      selectedCabinetId,
      selectedCabinetName: option.name,
      selectedCabinetOrderCount: option.orderCount,
      orderList,
    });
  },

  scanBarcode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const context = scanContext.parseScanResult(res);
        if (context.type === 'order-scene') {
          this._openOrderByScanScene(context.value);
          return;
        }
        if (context.type === 'order') return this._openOrderFromScene(context.value);
        if (context.type === 'cabinet') {
          this.setData({ cabinetId: context.value, cabinetName: context.name || '', entrySource: 'cabinet-code' });
          wx.showToast({ title: '已识别柜机', icon: 'success' });
          return;
        }
        if (context.type === 'cabinet-scene') {
          wx.showToast({ title: '请扫描订单标签的小程序码', icon: 'none' });
          return;
        }
        if (!res.result) {
          wx.showToast({ title: '未识别到有效订单码', icon: 'none' });
          return;
        }
        this._activateOrder(res.result);
      },
      fail: () => {
        wx.showToast({ title: '扫码取消', icon: 'none' });
      },
    });
  },

  tapListOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    this._openOrderFromScene(orderId);
  },

  async _openOrderByScanScene(sceneKey) {
    if (!authService.requireRole(ROLE.MANAGER)) return;
    try {
      const order = await orderApi.getOrderByScanScene(sceneKey);
      if (!order || !(order.orderId || order.id)) throw new Error('未找到对应订单');
      this._showOrderFound(order);
    } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  callPhone(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim();
    if (phone) wx.makePhoneCall({ phoneNumber: phone });
  },

  preventBubble() {},

  async printOrder(e) {
    const orderId = String(e.currentTarget.dataset.id || '');
    if (!orderId || this.data.printingOrderId) return;
    this.setData({ printingOrderId: orderId });
    try {
      await printerService.print({ orderId, canvasText: this.canvasText, canvasBarCode: this.canvasBarCode });
      wx.showToast({ title: '打印完成', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '订单打印失败', icon: 'none' });
    } finally {
      this.setData({ printingOrderId: '' });
    }
  },

  reconnectPrinter() { printerService.startDiscovery({ autoConnect: true }).catch(error => wx.showToast({ title: error.message || '搜索打印机失败', icon: 'none' })); },

  selectPrinter() {
    if (this.data.printerPrinting || this.data.printerStatus === 'connecting') return;
    wx.navigateTo({
      url: '/pages/printer/index',
      fail: error => wx.showToast({ title: error.errMsg || '打开打印机选择页失败', icon: 'none' }),
    });
  },

  _activateOrder(barcodeId) {
    this._openOrderFromScene(barcodeId);
  },

  _showOrderFound(raw) {
    const order = enrichOrder(raw);
    this.setData({
      order,
      selectedCabinetType: order.cabinetType,
      returnOperationId: '',
      returnOpenKey: `area-return-open-${order.id}-${Date.now()}`,
      returnConfirmKey: `area-return-confirm-${order.id}-${Date.now()}`,
      stage: 'order-found',
    });
  },

  selectCabinet(e) {
    this.setData({ selectedCabinetType: e.currentTarget.dataset.type });
  },

  async openDoor() {
    this.setData({ stage: 'opening', retrying: false, errorMsg: '' });
    try {
      if (this.data.mode === 'pickup') {
          const idempotencyKey = `area-pickup-${this.data.order.id}-${Date.now()}`;
          await areaAdminApi.pickUpOrder(this.data.order.id, idempotencyKey);
      } else {
          const cabinetId = this.data.cabinetId
            || this.data.order.returnCabinetId
            || this.data.order.depositCabinetId;
          if (!cabinetId) throw new Error('请先扫描返柜柜机二维码');
          const result = await areaAdminApi.openReturnCompartment(this.data.order.id, {
            cabinetId,
            // 后端 AreaAdminReturnRequest 的字段名是 compartmentSize。
            compartmentSize: this.data.selectedCabinetType.toUpperCase(),
          }, this.data.returnOpenKey);
          // 当前后端接口返回 Result<Void>：设备开柜成功后 data 为 null，
          // 订单状态也在本次请求中直接推进，不需要再次调用 return/confirm。
          const operationId = result && (result.operationId || result.operation_id || result.operationID);
          this.setData({
            returnOperationId: operationId ? String(operationId) : '',
            stage: 'done',
          });
          this._refreshList();
          return;
      }
      this.setData({ stage: 'confirm-close' });
    } catch (e) {
      this.setData({ stage: 'error-open', errorMsg: e.message || '格口未能成功打开' });
    }
  },

  // 从列表直接开柜（不进入 order-found 选格口步骤，直接用订单默认规格）
  async quickOpenDoor(e) {
    const orderId = String(e.currentTarget.dataset.id || '');
    if (!orderId || this.data.submitting || this.data.stage !== 'idle') return;

    // 取衣不需要先打开订单详情。列表中的订单已经经过区域范围和待取阶段筛选，
    // 直接进入开柜流程可以避免详情接口失败/返回结构变化导致 pickup 请求永远不发出。
    if (this.data.mode === 'pickup') {
      const listedOrder = this.data.allOrderList.find((item) => String(item.id) === orderId)
        || this.data.orderList.find((item) => String(item.id) === orderId);
      if (!listedOrder) {
        wx.showToast({ title: '订单信息已刷新，请重新操作', icon: 'none' });
        return;
      }
      this.setData({
        order: listedOrder,
        selectedCabinetType: listedOrder.cabinetType,
        returnOperationId: '',
        returnOpenKey: `area-return-open-${orderId}-${Date.now()}`,
        returnConfirmKey: `area-return-confirm-${orderId}-${Date.now()}`,
      }, () => this.openDoor());
      return;
    }

    let raw;
    try { raw = await areaAdminApi.getAreaAdminOrderById(orderId); } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
      return;
    }
    if (!raw) return;
    const order = enrichOrder(raw);
    this.setData({
      order,
      selectedCabinetType: order.cabinetType,
      returnOperationId: '',
      returnOpenKey: `area-return-open-${order.id}-${Date.now()}`,
      returnConfirmKey: `area-return-confirm-${order.id}-${Date.now()}`,
    }, () => this.openDoor());
  },

  retryOpen() {
    this.setData({ retrying: true });
    this.openDoor();
  },

  async confirmClose() {
    if (this.data.submitting) return;
    if (this.data.mode === 'pickup' || this.data.mode === 'delivery') {
      this.setData({ stage: 'done' });
      this._refreshList();
      return;
    }
    this.setData({ submitting: true });
    try {
      await areaAdminApi.confirmReturnOrder(
        this.data.order.id,
        this.data.returnOperationId,
        this.data.returnConfirmKey,
      );
      this.setData({ stage: 'done', submitting: false });
      this._refreshList();
    } catch (error) {
      this.setData({ submitting: false });
      wx.showToast({ title: error.message || '返柜确认失败', icon: 'none' });
    }
  },

  doorNotClosed() {
    wx.showModal({
      title: '请关闭柜门',
      content: '请确认操作完成并将柜门关好后，再点击"已关闭"。',
      showCancel: false,
      confirmText: '好的',
    });
  },

  reportError() {
    wx.showModal({
      title: '异常报告',
      content: '已记录本次开柜异常，工作人员将尽快处理。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  resetScan() {
    this._refreshList();
    this.setData({
      stage: 'idle',
      order: null,
      errorMsg: '',
      retrying: false,
      returnOperationId: '',
      returnOpenKey: '',
      returnConfirmKey: '',
    });
  },

  scanAgain() {
    this._refreshList();
    this.setData({ stage: 'idle', order: null, returnOperationId: '', returnOpenKey: '', returnConfirmKey: '' });
  },

  goHome() {
    this.resetScan();
  },

  // 这两个阶段柜门已开或正在开，中途离开需要提醒一次。
  goUserMode() {
    if (['opening', 'confirm-close'].indexOf(this.data.stage) === -1) {
      this.resetScan();
      return;
    }
    wx.showModal({
      title: '离开当前操作？',
      content: '柜门操作尚未确认完成，离开后需重新扫码处理该订单。',
      confirmText: '仍要离开',
      cancelText: '继续操作',
      success: (res) => {
        if (res.confirm) this.resetScan();
      },
    });
  },

  onUnload() {
    if (this.printerUnsubscribe) this.printerUnsubscribe();
    printerService.destroy();
  },
});
