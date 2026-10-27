const authService = require('../../services/auth-service');
const orderApi = require('../../api/order');
const deviceCommandApi = require('../../api/device-command');
const errorUtil = require('../../utils/error');
const doorConfirmation = require('../../services/door-confirmation');
const staffOrderApi = require('../../api/staff-order');
const areaAdminApi = require('../../api/area-admin');
const scanContext = require('../../utils/scan-context');
const session = require('../../utils/session');

const STATUS_MAP = {
  PENDING_DEPOSIT:        { label: '待存衣',     hint: '请前往所选柜机存入衣物',       icon: '/assets/icons/package-open.svg', color: 'blue' },
  WAITING_PICKUP:         { label: '待取件',     hint: '衣物已存入，等待管理员取件',   icon: '/assets/icons/truck.svg', color: 'purple' },
  WASHING:                { label: '洗护中',     hint: '衣物正在洗护，请耐心等待',     icon: '/assets/icons/washing-machine.svg', color: 'amber' },
  WAITING_RETURN:         { label: '待返柜',     hint: '洗护已完成，等待管理员返柜',   icon: '/assets/icons/truck.svg', color: 'amber' },
  WAITING_PAYMENT_PICKUP: { label: '待付款取衣', hint: '衣物已返柜，请完成付款后取衣', icon: '/assets/icons/scan-line.svg', color: 'green' },
  COMPLETED:              { label: '已完成',     hint: '订单已完成',                   icon: '/assets/icons/circle-check.svg', color: 'slate' },
  CANCELLED:              { label: '已取消',     hint: '订单已取消',                   icon: '/assets/icons/circle-alert-amber.svg', color: 'slate' },
  REWASHING:              { label: '返洗中',     hint: '衣物正在重新洗护',             icon: '/assets/icons/rotate-ccw.svg', color: 'amber' },
  EXCEPTION:              { label: '异常待处理', hint: '订单存在异常，请联系客服',     icon: '/assets/icons/circle-alert-amber.svg', color: 'red' },
  created:                { label: '待存衣',     hint: '请前往所选柜机存入衣物',       icon: '/assets/icons/package-open.svg', color: 'blue' },
  cleaning:               { label: '洗护中',     hint: '衣物正在洗护，请耐心等待',     icon: '/assets/icons/washing-machine.svg', color: 'amber' },
  ready:                  { label: '待取衣',     hint: '衣物已洗好，请扫码取回',       icon: '/assets/icons/scan-line.svg', color: 'green' },
  completed:              { label: '已完成',     hint: '订单已完成',                   icon: '/assets/icons/circle-check.svg', color: 'slate' },
};

const STEPS = [
  { key: 'PENDING_DEPOSIT',        name: '已下单' },
  { key: 'WAITING_PICKUP',         name: '已存衣' },
  { key: 'WASHING',                name: '洗护中' },
  { key: 'WAITING_RETURN',         name: '待返柜' },
  { key: 'WAITING_PAYMENT_PICKUP', name: '待取衣' },
  { key: 'COMPLETED',              name: '已完成' },
];

const CANCELLABLE_STATUSES = ['PENDING_DEPOSIT', 'WAITING_PICKUP', 'WASHING'];

const STEP_INDEX = {
  PENDING_DEPOSIT: 0,
  WAITING_PICKUP: 1,
  WASHING: 2,
  REWASHING: 2,
  WAITING_RETURN: 3,
  WAITING_PAYMENT_PICKUP: 4,
  COMPLETED: 5,
  created: 0,
  cleaning: 2,
  ready: 4,
  completed: 5,
};

const STATUS_STEP_KEY = {
  created: 'PENDING_DEPOSIT',
  cleaning: 'WASHING',
  ready: 'WAITING_PAYMENT_PICKUP',
  completed: 'COMPLETED',
};

function normalizeStatus(value) {
  const rawStatus = String(value || '').trim();
  const upperStatus = rawStatus.toUpperCase();
  const legacyStatus = {
    CREATED: 'PENDING_DEPOSIT',
    CLEANING: 'WASHING',
    PENDING_PICKUP: 'WAITING_PICKUP',
    READY: 'WAITING_PAYMENT_PICKUP',
    COMPLETED: 'COMPLETED',
  };
  return legacyStatus[upperStatus] || upperStatus || 'PENDING_DEPOSIT';
}

function isPaidStatus(value) {
  return [
    'PAID', 'SUCCESS', 'SUCCEEDED', 'SUCCESSFUL', 'COMPLETED',
    'PAYMENTSUCCESS', 'TRADESUCCESS',
  ].includes(String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
}

function getCabinetOperationId(result) {
  let value = result;
  for (let depth = 0; depth < 3 && value && typeof value === 'object'; depth += 1) {
    const operationId = value.cabinetOperationId
      || value.cabinetOperationID
      || value.depositOperationId
      || value.depositOperationID
      || value.operationId
      || value.operationID
      || value.operation_id
      || value.id;
    if (operationId !== undefined && operationId !== null && operationId !== '') return String(operationId);
    value = value.data || value.result || value.operation || value.operationInfo;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

Page({
  data: {
    order: null,
    statusInfo: null,
    progressSteps: [],
    loading: true,
    loadError: '',
    actionSubmitting: false,
    paymentSubmitting: false,
  },

  onLoad(options = {}) {
    const context = scanContext.parse(options);
    const scanSceneKey = context.type === 'order-scene' ? context.value : '';
    if (!authService.isAuthenticated()) {
      session.savePendingLaunch(scanContext.buildLaunchUrl({
        path: 'pages/order-detail/order-detail',
        query: scanSceneKey ? { scanSceneKey } : options,
      }));
    }
    if (!authService.requireLogin()) return;
    if (scanSceneKey && !['manager', 'staff'].includes(authService.getRole())) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    const orderId = options.orderId || options.id;
    if (scanSceneKey) { this.loadOrderByScanScene(scanSceneKey); return; }
    if (!orderId || orderId === 'undefined' || orderId === 'null') {
      this.setData({ loading: false, loadError: '缺少订单信息，请重新扫描订单小程序码' });
      wx.showToast({ title: '缺少订单信息', icon: 'none' });
      return;
    }
    this.loadOrder(orderId);
  },

  async loadOrderByScanScene(scanSceneKey) {
    try {
      const response = await orderApi.getOrderByScanScene(scanSceneKey);
      const orderId = response.orderId || response.id;
      if (!orderId) throw new Error('订单不存在');
      this.loadOrder(orderId);
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '订单信息加载失败' });
      wx.showToast({ title: error.message || '订单信息加载失败', icon: 'none' });
    }
  },

  onShow() {
    if (this._hasShown && this.data.order) this.loadOrder(this.data.order.orderId);
    this._hasShown = true;
  },

  async loadOrder(id) {
    this.setData({ loading: true, loadError: '' });
    try {
      const role = authService.getRole();
      const response = role === 'staff'
        ? await staffOrderApi.getStaffOrderById(id)
        : role === 'manager'
          ? await areaAdminApi.getAreaAdminOrderById(id)
          : await orderApi.getOrderById(id);
      const statusHistory = (Array.isArray(response.statusList) ? response.statusList : [])
        .map((record) => {
          const status = normalizeStatus(record.orderStatus || record.status);
          return {
            ...record,
            status,
            label: (STATUS_MAP[status] || {}).label || status || '状态未知',
            changedAtLabel: this._formatDateTime(record.changedAt),
          };
        })
        .sort((left, right) => this._toTimestamp(left.changedAt) - this._toTimestamp(right.changedAt));
      const latestHistory = statusHistory[statusHistory.length - 1];
      const status = normalizeStatus(response.orderStatus || response.status || (latestHistory && latestHistory.status));
      const finalOriginalAmount = response.finalOriginalAmount ?? response.FinalOriginalAmount;
      const finalPayableAmount = response.finalPayableAmount ?? response.FinalPayableAmount;
      const internalStage = String(response.internalStage || '').toUpperCase();
      const normalizedInternalStage = internalStage.replace(/[^A-Z0-9]/g, '');
      const canPickupCancelledOrder = status === 'CANCELLED'
        && normalizedInternalStage === 'CANCELLEDWAITINGUSERPICKUP';
      const rewashStatus = String(response.rewashStatus || response.rewashApprovalStatus || '').toUpperCase();
      const rewashRound = Number(response.currentRewashRound ?? response.rewashRound ?? 0);
      const hasRewashMarker = response.isRewash === true
        || response.rewash === true
        || response.rewashApproved === true
        || rewashStatus === 'APPROVED'
        || rewashRound >= 1
        || response.rewashRequest !== null && response.rewashRequest !== undefined;
      const isRewashDeposit = (status === 'REWASHING' && normalizedInternalStage === 'REWASHAPPROVED')
        || (status === 'PENDING_DEPOSIT' && normalizedInternalStage === 'CREATED' && hasRewashMarker);
      const paymentStatus = String(
        response.paymentStatus
        || response.payStatus
        || (response.payment && (response.payment.paymentStatus || response.payment.transactionStatus || response.payment.status))
        || '',
      ).toUpperCase();
      const isPaid = isPaidStatus(paymentStatus) || response.paid === true || response.isPaid === true;
      const deliveryCode = String(response.deliveryCode || '').trim();
      const order = {
        ...response,
        id: response.orderId ?? response.id,
        orderId: response.orderId ?? response.id,
        orderNo: String(response.orderNo || ''),
        deliveryCode,
        hasDeliveryCode: /^[A-Za-z0-9]{4}$/.test(deliveryCode),
        status,
        canCancel: response.canCancel === true || CANCELLABLE_STATUSES.includes(status),
        canApplyRewash: response.canApplyRewash === true || status === 'COMPLETED',
        canPay: (internalStage === 'PRICE_FINAL_CONFIRMED' || status === 'WAITING_PAYMENT_PICKUP') && !isPaid,
        canPickup: (status === 'WAITING_PAYMENT_PICKUP' && isPaid) || canPickupCancelledOrder,
        canPickupCancelledOrder,
        canDeposit: status === 'PENDING_DEPOSIT' || isRewashDeposit,
        isRewashDeposit,
        rewashDepositPrepared: false,
        cabinetId: response.cabinetId ?? response.depositCabinetId ?? null,
        compartmentSize: String(
          response.compartmentSize || response.requestedDepositSize || '',
        ).toUpperCase() || null,
        rewashRequested: response.rewashRequested === true
          || response.rewashRequest !== null && response.rewashRequest !== undefined,
        cabinetType: String(response.cabinetType || response.requestedDepositSize || 'small').toLowerCase(),
        cabinetLatitude: response.cabinetLatitude ?? response.depositCabinetLatitude ?? response.latitude ?? '',
        cabinetLongitude: response.cabinetLongitude ?? response.depositCabinetLongitude ?? response.longitude ?? '',
        statusHistory,
        items: Array.isArray(response.items) ? response.items.map((item) => ({
          ...item,
          name: item.name || item.categoryNameSnapshot || item.categoryName || '衣物',
          categoryName: item.categoryName || item.categoryDetail || '',
          count: item.count ?? item.quantity ?? 0,
          price: item.price ?? item.unitPrice ?? item.estimatedUnitPrice,
          hasPrice: item.price !== undefined || item.unitPrice !== undefined || item.estimatedUnitPrice !== undefined,
        })) : [],
        imageUrls: Array.isArray(response.imageUrls) ? response.imageUrls.filter(Boolean) : [],
        createdAtLabel: this._formatDateTime(response.createdAt),
        paidAtLabel: this._formatDateTime(response.paidAt),
        completedAtLabel: this._formatDateTime(response.completedAt),
        cancelledAtLabel: this._formatDateTime(response.cancelledAt),
        estimatedOriginalAmountLabel: this._formatAmount(response.estimatedOriginalAmount),
        estimatedPayableAmountLabel: this._formatAmount(response.estimatedPayableAmount),
        finalOriginalAmountLabel: this._formatAmount(finalOriginalAmount),
        finalPayableAmountLabel: this._formatAmount(finalPayableAmount),
        hasEstimatedOriginalAmount: this._hasValue(response.estimatedOriginalAmount),
        hasEstimatedPayableAmount: this._hasValue(response.estimatedPayableAmount),
        hasFinalOriginalAmount: this._hasValue(finalOriginalAmount),
        hasFinalPayableAmount: this._hasValue(finalPayableAmount),
        hasDepositCompartmentNo: this._hasValue(response.depositCompartmentNo),
        hasReturnCompartmentNo: this._hasValue(response.returnCompartmentNo),
        hasRewashRound: this._hasValue(response.rewashRound),
      };
      const statusInfo = STATUS_MAP[status] || { label: status, hint: '订单状态已更新', icon: '/assets/icons/info.svg', color: 'slate' };
      const activeIdx = STEP_INDEX[status];
      const historyByStatus = statusHistory.reduce((result, record) => {
        const stepKey = STATUS_STEP_KEY[record.status] || record.status;
        if (stepKey && !result[stepKey]) result[stepKey] = record;
        return result;
      }, {});
      const progressSteps = STEPS.map((step, index) => ({
        ...step,
        done: activeIdx !== undefined && index < activeIdx,
        active: activeIdx !== undefined && index === activeIdx,
        time: historyByStatus[step.key] ? this._formatShortDateTime(historyByStatus[step.key].changedAt) : '',
      }));
      this.setData({ order, statusInfo, progressSteps, loading: false });
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '订单信息加载失败' });
      wx.showToast({ title: error.message || '订单信息加载失败', icon: 'none' });
    }
  },

  _hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  },

  _formatAmount(value) {
    if (!this._hasValue(value)) return '';
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : String(value);
  },

  _toTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const normalized = String(value)
      .trim()
      .replace('T', ' ')
      .replace(/\.\d+/, '')
      .replace(/-/g, '/');
    const timestamp = new Date(normalized).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  },

  _formatDateTime(value) {
    if (!value) return '';
    const timestamp = this._toTimestamp(value);
    if (!timestamp) return String(value);
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  _formatShortDateTime(value) {
    if (!value) return '';
    const timestamp = this._toTimestamp(value);
    if (!timestamp) return String(value);
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.url;
    if (!current || !this.data.order.imageUrls.length) return;
    wx.previewImage({ current, urls: this.data.order.imageUrls });
  },

  copyDeliveryCode() {
    const deliveryCode = String(this.data.order && this.data.order.deliveryCode || '').trim();
    if (!deliveryCode) return;
    wx.setClipboardData({
      data: deliveryCode,
      success: () => wx.showToast({ title: '取货码已复制', icon: 'success' }),
    });
  },

  scanPickup() {
    const order = this.data.order;
    if (!order || !order.orderId) return;
    if (order.canPickupCancelledOrder) {
      if (this.data.actionSubmitting) return;
      wx.showModal({
        title: '确认取出衣物',
        content: '确认现在开柜取出取消订单的衣物吗？',
        confirmText: '确认开柜',
        cancelText: '暂不取出',
        success: ({ confirm }) => {
          if (confirm) this.pickupCancelledOrder();
        },
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/scan-cabinet/scan-cabinet?mode=pickup&orderId=${encodeURIComponent(String(order.orderId))}`,
    });
  },

  async pickupCancelledOrder() {
    const order = this.data.order;
    if (!order || !order.orderId || !order.canPickupCancelledOrder || this.data.actionSubmitting) return;
    this.setData({ actionSubmitting: true });
    try {
      const outcome = await doorConfirmation.runDoorConfirmation({
        send: () => orderApi.pickUpOrder(
          order.orderId,
          '',
          `cancelled-pickup-${order.orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ),
        confirmOpened: (outcome) => orderApi.confirmPickupOpened(order.orderId, outcome.cabinetOperationId),
      });
      if (outcome === 'support') return;
      wx.showToast({ title: '开柜流程已继续，请取出衣物', icon: 'success', duration: 2200 });
      await this.loadOrder(order.orderId);
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '开柜取衣失败，请重试'), icon: 'none' });
    } finally {
      this.setData({ actionSubmitting: false });
    }
  },

  async openDeposit() {
    const order = this.data.order;
    if (!order || !order.orderId || !order.canDeposit || this.data.actionSubmitting) return;
    this.setData({ actionSubmitting: true });
    try {
      const commandPayload = { orderId: order.orderId };
      if (order.isRewashDeposit && !order.rewashDepositPrepared) {
        const result = await this.prepareRewashDeposit(order);
        const cabinetOperationId = getCabinetOperationId(result);
        if (!cabinetOperationId) {
          throw new Error('反洗开柜操作创建失败，请稍后重试');
        }
      }
      const outcome = await doorConfirmation.runDoorConfirmation({
        send: () => deviceCommandApi.sendDeviceCommand(commandPayload),
        confirmOpened: (result) => deviceCommandApi.confirmDepositOpened(order.orderId, result.cabinetOperationId),
      });
      if (outcome === 'support') return;
      wx.showToast({ title: '开柜流程已继续', icon: 'success' });
      await this.loadOrder(order.orderId);
    } catch (error) {
      const cancelMessage = String(error && (error.errMsg || error.message) || '');
      if (!/cancel|取消/i.test(cancelMessage)) {
        wx.showToast({ title: errorUtil.getMessage(error, '开柜失败，请稍后重试'), icon: 'none' });
      }
    } finally {
      this.setData({ actionSubmitting: false });
    }
  },

  async prepareRewashDeposit(order) {
    const idempotencyKey = `rewash-deposit-${order.orderId}-${Date.now()}`;
    const result = await orderApi.prepareRewashDeposit(order.orderId, null, null, idempotencyKey);
    this.setData({ 'order.rewashDepositPrepared': true });
    return result;
  },

  async payOrder() {
    const order = this.data.order;
    if (this.data.paymentSubmitting || this.data.actionSubmitting || !order || !order.canPay) return;
    this.setData({ paymentSubmitting: true });
    const idempotencyKey = `payment-${order.orderId}-${Date.now()}`;
    try {
      const payment = await orderApi.prepayOrder(order.orderId, idempotencyKey);
      if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
        throw new Error('支付参数不完整，请稍后重试');
      }
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(payment.timeStamp),
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType || 'RSA',
          paySign: payment.paySign,
          success: resolve,
          fail: reject,
        });
      });
      wx.showToast({ title: '支付成功', icon: 'success' });
      await this.loadOrder(order.orderId);
    } catch (error) {
      const message = error && /cancel/i.test(error.errMsg || '')
        ? '已取消支付'
        : errorUtil.getMessage(error, '支付失败，请重试');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ paymentSubmitting: false });
    }
  },

  cancelOrder() {
    if (this.data.actionSubmitting || this.data.paymentSubmitting || !this.data.order || !this.data.order.canCancel) return;
    wx.showModal({
      title: '确认取消订单',
      content: '取消后订单将停止洗护流程，已存入柜机的衣物需要在订单详情中取出。确定要取消吗？',
      confirmText: '确认取消',
      confirmColor: '#a33b45',
      success: ({ confirm }) => {
        if (confirm) this._submitCancellation('用户主动取消');
      },
    });
  },

  async _submitCancellation(reason) {
    if (this.data.actionSubmitting || !this.data.order || !this.data.order.canCancel) return;
    const user = authService.getCurrentUser() || {};
    const userId = user.id || user.accountId || user.userId;
    if (!userId) {
      wx.showToast({ title: '用户信息不完整，请重新登录', icon: 'none' });
      return;
    }
    this.setData({ actionSubmitting: true });
    const requestId = `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await orderApi.cancelOrder({
        orderId: this.data.order.orderId,
        userId,
        reason,
        requestId,
      }, requestId);
      wx.showToast({ title: '订单已取消', icon: 'success' });
      await this.loadOrder(this.data.order.orderId);
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '取消失败，请重试'), icon: 'none' });
    } finally {
      this.setData({ actionSubmitting: false });
    }
  },

  applyRewash() {
    if (this.data.actionSubmitting || !this.data.order || !this.data.order.canApplyRewash || this.data.order.rewashRequested) return;
    wx.navigateTo({
      url: `/pages/rewash-apply/index?orderId=${encodeURIComponent(String(this.data.order.orderId))}`,
      fail: () => wx.showToast({ title: '申请页面打开失败，请重试', icon: 'none' }),
    });
  },
});
