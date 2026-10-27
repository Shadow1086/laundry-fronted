const authService = require('../../services/auth-service');
const staffOrderApi = require('../../api/staff-order');
const orderApi = require('../../api/order');
const { ROLE } = require('../../constants/role');
const scanContext = require('../../utils/scan-context');

const STATUS_LABEL = {
  PENDING_DEPOSIT: '待存衣',
  WAITING_PICKUP: '待洗护',
  WASHING: '洗护中',
  WAITING_RETURN: '待返柜',
  WAITING_PAYMENT_PICKUP: '待取衣',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REWASHING: '返洗中',
  EXCEPTION: '异常待处理',
};

const MODE_INTERNAL_STAGE = {
  arrival: 'GARMENT_RECEIVED',
  washing: 'PRICE_FINAL_CONFIRMED',
};
const HISTORY_INTERNAL_STAGES = [
  'CREATED', 'DEPOSIT_CONFIRMED', 'GARMENT_RECEIVED', 'DELIVERED_TO_LAUNDRY',
  'PRICE_FINAL_CONFIRMED', 'WASH_FINISHED', 'RETURN_CONFIRMED',
  'PAYMENT_CONFIRMED', 'USER_PICKUP_CONFIRMED', 'CANCELLED',
  'CANCELLED_WAITING_USER_PICKUP', 'CANCELLED_WAITING_RETURN',
  'REWASH_APPROVED', 'EXCEPTION',
];

function parseScannedOrder(result) {
    const value = String(result || '').trim();
    if (!value) return '';
    const queryStart = value.indexOf('?');
    if (queryStart < 0) return value;
    try {
        const query = value.slice(queryStart + 1).split('#')[0];
        const params = query.split('&');
        for (let index = 0; index < params.length; index += 1) {
            const pair = params[index].split('=');
            const key = decodeURIComponent(pair[0]);
            if (key === 'orderId' || key === 'id') {
                return decodeURIComponent(pair.slice(1).join('='));
            }
        }
    } catch (error) {
        return value.slice(0, queryStart);
    }
    return value.slice(0, queryStart);
}

function adaptOrder(raw) {
    const status = raw.orderStatus || raw.status || '';
    const items = raw.items || raw.laundryOrderItems || [];
    const returnCabinet = raw.returnCabinet || {};
    const returnCompartment = raw.returnCompartment || {};
    const rawPhotos = raw.photos || raw.imageUrls || raw.imageUrl || [];
    return {
        ...raw,
        id: String(raw.id ?? raw.orderId ?? ''),
        orderNo: String(raw.orderNo || ''),
        status,
        statusLabel: STATUS_LABEL[status] || status,
        storeName: raw.storeName || raw.serviceSiteName || raw.cabinetName || '洗衣订单',
        customerName: raw.userName || '未填写姓名',
        customerPhone: raw.userPhone || '',
        cabinetLabel: raw.returnCabinetName || returnCabinet.cabinetName || returnCabinet.name || raw.cabinetName || raw.depositCabinetName || raw.returnCabinetId || raw.depositCabinetId || '',
        compartmentLabel: raw.returnCompartmentNo || returnCompartment.compartmentNo || returnCompartment.no || raw.compartmentNo || raw.depositCompartmentNo || raw.returnCompartmentId || raw.depositCompartmentId || '',
        createdAtLabel: raw.createdAt || '',
        updatedAtLabel: raw.updatedAt || '',
        items: items.map((item) => ({
            ...item,
            categoryDisplayId: item.actualCategoryId ?? item.categoryId ?? '',
            categoryDisplayName: item.actualCategoryName
                || item.actualCategoryNameSnapshot
                || item.categoryNameSnapshot
                || item.categoryName
                || '',
            name: item.name || item.actualCategoryName || item.actualCategoryNameSnapshot
                || item.categoryNameSnapshot || item.categoryName || item.productName || '衣物',
            count: item.count ?? item.quantity ?? 1,
        })),
        photos: (Array.isArray(rawPhotos) ? rawPhotos : [rawPhotos]).filter(Boolean),
    };
}

function enrichOrder(raw) {
    return {
        ...raw,
        orderNo: String(raw.orderNo || raw.id || ''),
        statusLabel: STATUS_LABEL[raw.status] || raw.status,
    };
}

Page({
  data: {
    // stage: idle | working | confirm
    stage: 'idle',
    mode: 'arrival',
    order: null,
    // 当前正在拍的照片（pre-wash 新拍，confirm 阶段用）
    pendingPhotos: [],
    // idle 列表
    orderList: [],
    loading: false,
    submitting: false,
  },

  onLoad(options) {
    const context = scanContext.parse(options);
    if (context.type === 'order' && context.value) this._pendingOrderId = context.value;
  },

  onShow() {
    if (!authService.requireRole(ROLE.STAFF)) return;
    if (this._pendingOrderId) {
      const orderId = this._pendingOrderId;
      this._pendingOrderId = '';
      this._activateByBarcode(orderId);
      return;
    }
    this._refreshList();
  },

  async onPullDownRefresh() {
    try {
      await this._refreshList();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  setMode(e) {
    if (this.data.stage !== 'idle' || this.data.loading) return;
    const mode = e.currentTarget.dataset.mode;
    if ((mode !== 'history' && !MODE_INTERNAL_STAGE[mode]) || mode === this.data.mode) return;
    this.setData({ mode, orderList: [] });
    this._refreshList(mode);
  },

  async _refreshList(mode) {
    const activeMode = mode || this.data.mode;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await staffOrderApi.getStaffOrders({
        page: 1,
        pageSize: 100,
        internalStage: activeMode === 'history' ? HISTORY_INTERNAL_STAGES : MODE_INTERNAL_STAGE[activeMode],
      });
      const records = Array.isArray(result) ? result : (result && result.records) || [];
      const uniqueRecords = [...new Map(records.map((record) => [String(record.id ?? record.orderId), record])).values()];
      const orderList = uniqueRecords
        .sort((left, right) => new Date(right.updatedAt || right.createAt || right.createdAt || 0)
          - new Date(left.updatedAt || left.createAt || left.createdAt || 0))
        .map(adaptOrder);
      this.setData({ orderList, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '订单列表加载失败', icon: 'none' });
    }
  },

  scanBarcode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const context = scanContext.parseScanResult(res);
        if (context.type === 'order-scene') {
          this._activateByScanScene(context.value);
          return;
        }
        if (context.type === 'cabinet' || context.type === 'cabinet-scene') {
          wx.showToast({ title: '请扫描订单标签的小程序码', icon: 'none' });
          return;
        }
        this._activateByBarcode(context.type === 'order' ? context.value : res.result);
      },
      fail: () => {
        wx.showToast({ title: '扫码取消', icon: 'none' });
      },
    });
  },

  async _activateByBarcode(barcodeId) {
    const orderId = parseScannedOrder(barcodeId);
    if (!orderId) {
      wx.showToast({ title: '无效订单码', icon: 'none' });
      return;
    }
    try {
      const raw = await staffOrderApi.getStaffOrderById(orderId);
      if (!raw) throw new Error('未找到对应订单');
      this._enterWorking(raw);
    } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  async _activateByScanScene(sceneKey) {
    if (!authService.requireRole(ROLE.STAFF)) return;
    try {
      const order = await orderApi.getOrderByScanScene(sceneKey);
      if (!order || !(order.orderId || order.id)) throw new Error('未找到对应订单');
      this._enterWorking(order);
    } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  async tapListOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    if (this.data.mode === 'history') {
      this.openPrinter(orderId);
      return;
    }
    try {
      const raw = await staffOrderApi.getStaffOrderById(orderId);
      if (!raw) throw new Error('未找到对应订单');
      this._enterWorking(raw);
    } catch (error) {
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  callCustomer(e) {
    const phoneNumber = String(e.currentTarget.dataset.phone || '').trim();
    if (phoneNumber) wx.makePhoneCall({ phoneNumber });
  },

  previewInspectionPhoto(e) {
    const current = e.currentTarget.dataset.url;
    const urls = this.data.order && this.data.order.photos || [];
    if (!current || !urls.length) return;
    wx.previewImage({ current, urls });
  },

  openPrinter() {
    const orderId = this.data.order && this.data.order.id;
    if (!orderId) return;
    wx.navigateTo({
      url: `/pages/printer/index?orderId=${encodeURIComponent(orderId)}`,
    });
  },

  openHistoryPrinter(e) {
    const orderId = String(e.currentTarget.dataset.id || '');
    if (!orderId) return;
    wx.navigateTo({
      url: '/pages/printer/index?orderId=' + encodeURIComponent(orderId),
    });
  },

  registerCleaning() {
    wx.showToast({ title: '已登记，清洗流程待接入', icon: 'none' });
  },

  _enterWorking(raw) {
    const order = adaptOrder(raw);
    const expectedStage = MODE_INTERNAL_STAGE[this.data.mode];
    if (order.internalStage && order.internalStage !== expectedStage) {
      wx.showToast({
        title: this.data.mode === 'arrival' ? '该订单不在待到店阶段' : '该订单暂不能完成洗护',
        icon: 'none',
      });
      return;
    }
    this.setData({
      stage: 'working',
      order,
      pendingPhotos: [],
    });
  },

  // 连拍：一次调起摄像头，用户可连续拍多张，拍完点"完成"返回所有 tempFilePaths
  takePhotos() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['camera'],
      success: (res) => {
        const newPaths = res.tempFiles.map(f => f.tempFilePath);
        const pendingPhotos = [...this.data.pendingPhotos, ...newPaths];
        this.setData({ pendingPhotos });
      },
    });
  },

  // 验衣照片可选，无照片时也允许确认到店。
  goConfirm() {
    this.setData({ stage: 'confirm' });
  },

  // 确认：保存照片，更新状态
  async confirmSubmit() {
    const { order, pendingPhotos } = this.data;
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      // 单请求携带全部验衣照片，一次幂等键覆盖整批。
      await staffOrderApi.uploadInspectionImages(
        order.id,
        pendingPhotos,
        `staff-check-${order.id}-${Date.now()}`,
      );
      wx.showToast({ title: '到店确认成功', icon: 'success' });
      this._reset();
    } catch (error) {
      wx.showToast({ title: error.message || '到店确认失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 洗后完成按钮
  async completeWash() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      if (this.data.pendingPhotos.length > 0) {
        await staffOrderApi.uploadInspectionImages(
          this.data.order.id,
          this.data.pendingPhotos,
          `staff-check-${this.data.order.id}-${Date.now()}`,
        );
      }
      await staffOrderApi.completeWash(this.data.order.id, `staff-complete-${this.data.order.id}-${Date.now()}`);
      await new Promise((resolve) => {
        wx.showModal({
          title: '清洗完成',
          content: '订单已更新为待取货，请将衣物袋放置到指定位置，等待区域管理员取货。',
          showCancel: false,
          confirmText: '知道了',
            success: resolve,
            fail: resolve,
        });
      });
      this._reset();
    } catch (error) {
      wx.showToast({ title: error.message || '状态更新失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  backToWorking() {
    this.setData({ stage: 'working' });
  },

  resetScan() {
    this._reset();
  },

  // 已拍摄但未提交的照片会丢失，离开前提醒一次。
  _reset() {
    this._refreshList();
    this.setData({ stage: 'idle', order: null, pendingPhotos: [] });
  },
});
