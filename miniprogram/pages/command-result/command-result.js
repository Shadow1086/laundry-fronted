const deviceCommandApi = require('../../api/device-command');
const authService = require('../../services/auth-service');
const { PAYMENT_AND_PICKUP_TEMPLATE_IDS } = require('../../constants/subscribe-template');
const locationService = require('../../services/location-service');
const { callSupport } = require('../../services/door-confirmation');
const { ROLE } = require('../../constants/role');

function failureState(error) {
  const result = error && error.result;
  const status = String(result && result.status || '').toUpperCase();
  const message = String(error && (error.message || error.errMsg) || '暂时无法开柜，请稍后重试');
  const networkFailure = /request:fail|timeout|network|网络|超时/i.test(message);
  const unconfirmed = status === 'UNCONFIRMED'
    || (!status && (networkFailure || message.includes('开锁命令已发送，但设备未确认')));
  const canRetry = !/次数已用尽|订单不存在|已取消|已完成|无权|权限|登录|订单状态|不允许|缺少订单|请从订单详情/.test(message);
  return {
    stage: 'error-open',
    errorTitle: unconfirmed ? '请先检查柜门' : '暂时无法开柜',
    errorMsg: networkFailure ? '网络连接中断，暂未获取开柜结果' : message,
    unconfirmed,
    canRetry,
    cabinetOperationId: result && (result.cabinetOperationId || result.operationId) || '',
  };
}

// 待确认结果不能作为开柜成功；仅已确认的指令或用户现场确认后进入后续流程。
Page({
  data: {
    stage: 'opening',
    cabinetType: 'small',
    mode: 'deposit',
    orderId: '',
    errorMsg: '',
    errorTitle: '暂时无法开柜',
    canRetry: true,
    unconfirmed: false,
    cabinetOperationId: '',
    confirmingOpened: false,
    doorOpenedConfirmed: false,
    retrying: false,
    confirming: false,
    contacting: false,
    cabinetLatitude: '',
    cabinetLongitude: '',
    userLatitude: '',
    userLongitude: '',
    distanceConfirmed: false,
  },

  onLoad(options = {}) {
    // onLoad 会直接下发开柜指令，未登录必须先拦住。
    if (!authService.requireLogin()) return;
    if (!options.orderId || ['undefined', 'null'].includes(String(options.orderId))) {
      wx.showToast({ title: '缺少订单信息', icon: 'none' });
      this.setData(failureState(new Error('缺少订单信息，请返回订单列表重新进入')));
      return;
    }
    const cabinetType = String(options.cabinetType || 'small').toLowerCase();
    const mode = options.mode === 'pickup' ? 'pickup' : 'deposit';
    this.setData({
      orderId: options.orderId,
      cabinetType: ['small', 'large'].includes(cabinetType) ? cabinetType : 'small',
      mode,
      cabinetLatitude: options.cabinetLatitude || '',
      cabinetLongitude: options.cabinetLongitude || '',
      userLatitude: options.userLatitude || '',
      userLongitude: options.userLongitude || '',
      distanceConfirmed: options.distanceConfirmed === '1',
    });
    this._openDoor();
  },

  async _openDoor() {
    if (this._opening || this.data.confirmingOpened) return;
    this._opening = true;
    this.setData({ stage: 'opening', retrying: true, errorMsg: '', unconfirmed: false, cabinetOperationId: '', doorOpenedConfirmed: false });
    try {
      if (this.data.mode === 'pickup') throw new Error('请从订单详情发起取衣开柜');
      const hasConfirmedLocation = this.data.distanceConfirmed
        && locationService.isValidCoordinate(this.data.userLatitude, this.data.userLongitude);
      const locationCheck = hasConfirmedLocation
        ? {
          allowed: true,
          userLocation: {
            latitude: Number(this.data.userLatitude),
            longitude: Number(this.data.userLongitude),
          },
        }
        : await locationService.checkCurrentDistance({
          latitude: this.data.cabinetLatitude,
          longitude: this.data.cabinetLongitude,
        });
      if (!locationCheck.allowed) {
        if (locationCheck.reason !== 'too-far') {
          throw new Error('柜机位置暂不可用，无法确认距离');
        }
        const shouldOpen = await new Promise((resolve) => {
          wx.showModal({
            title: '距离提示',
            content: `当前距离柜机约 ${Math.round(Number(locationCheck.distanceMeters))} 米，距离过远，请检查附近柜机并确认是否开柜。`,
            confirmText: '确认开柜',
            cancelText: '返回',
            success: ({ confirm }) => resolve(confirm),
            fail: () => resolve(false),
          });
        });
        if (!shouldOpen) {
          this.setData({ stage: 'idle', errorTitle: '本次未发起开柜', errorMsg: '请到达订单对应柜机后，再尝试开柜', canRetry: true });
          return;
        }
      }
      // 本次开柜流程已经完成距离确认，失败重试时沿用本次定位结果。
      this.setData({
        distanceConfirmed: true,
        userLatitude: locationCheck.userLocation.latitude,
        userLongitude: locationCheck.userLocation.longitude,
      });
      const commandPayload = {
        orderId: this.data.orderId,
        action: 'open',
        cabinetType: this.data.cabinetType,
        userLatitude: locationCheck.userLocation.latitude,
        userLongitude: locationCheck.userLocation.longitude,
      };
      const result = await deviceCommandApi.sendDeviceCommand(commandPayload);
      if (!result || result.status !== 'ACKNOWLEDGED') {
        const error = new Error(result && result.message || '暂未获取设备开柜确认，请检查柜门或联系客服');
        error.result = result || { status: 'UNCONFIRMED' };
        throw error;
      }
      this.setData({ stage: 'confirm-close', cabinetOperationId: result.cabinetOperationId || '' });
    } catch (e) {
      this.setData(failureState(e));
    } finally {
      this._opening = false;
      this.setData({ retrying: false });
    }
  },

  async retryOpen() {
    if (!this.data.orderId || !this.data.canRetry || this._opening || this._retryPrompt || this.data.confirmingOpened) return;
    if (this.data.unconfirmed) {
      this._retryPrompt = true;
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '确认柜门未打开',
        content: '请先检查柜门。只有柜门确实未打开时，才需要再次发送开柜指令。',
        confirmText: '未打开，重试',
        cancelText: '返回检查',
        success: ({ confirm }) => resolve(Boolean(confirm)),
        fail: () => resolve(false),
      }));
      this._retryPrompt = false;
      if (!confirmed) return;
    }
    await this._openDoor();
  },

  confirmOpened() {
    if (this._opening || this._retryPrompt || this.data.confirmingOpened || !this.data.unconfirmed || !this.data.cabinetOperationId) return;
    this.setData({ confirmingOpened: true });
    deviceCommandApi.confirmDepositOpened(this.data.orderId, this.data.cabinetOperationId)
      .then(() => this.setData({ stage: 'confirm-close', confirmingOpened: false, unconfirmed: false, doorOpenedConfirmed: true }))
      .catch((error) => {
        this.setData({ confirmingOpened: false });
        wx.showToast({ title: error.message || '确认失败，请重试', icon: 'none' });
      });
  },

  doorNotOpened() {
    if (this.data.stage !== 'confirm-close' || this.data.confirming) return;
    this.setData({
      stage: 'error-open',
      errorTitle: '柜门未打开',
      errorMsg: '开锁指令已确认，但柜门未实际打开。请检查柜门，仍无法打开时联系客服。',
      unconfirmed: false,
      canRetry: true,
    });
  },

  confirmClose() {
    if (this.data.stage !== 'confirm-close' || this.data.confirming) return;
    if (this.data.mode === 'pickup') {
      this.setData({ stage: 'done' });
      return;
    }
    // 该方法由用户点击触发，可以直接调起微信订阅授权弹窗。
    if (typeof wx.requestSubscribeMessage !== 'function') {
      this.setData({ stage: 'done', confirming: false });
      return;
    }
    this.setData({ confirming: true });
    wx.requestSubscribeMessage({
      tmplIds: PAYMENT_AND_PICKUP_TEMPLATE_IDS,
      success: (res) => {
        console.log('[command-result] subscribe authorization result', res);
        this.setData({ stage: 'done', confirming: false });
      },
      fail: (error) => {
        console.warn('[command-result] subscribe authorization failed', error);
        this.setData({ stage: 'done', confirming: false });
      },
    });
  },

  doorNotClosed() {
    // 门没有成功关上 → 退回到 confirm-close 再给一次机会
    wx.showModal({
      title: '请关闭柜门',
      content: `请确认衣物已${this.data.mode === 'pickup' ? '取出' : '放入'}并将柜门关好后，再点击“已关闭”。`,
      showCancel: false,
      confirmText: '好的',
    });
  },

  async goContactService() {
    if (this.data.contacting) return;
    this.setData({ contacting: true });
    try {
      await callSupport();
    } finally {
      this.setData({ contacting: false });
    }
  },

  goOrderDetail() {
    if (!this.data.orderId) return this.goOrders();
    wx.navigateTo({ url: `/pages/order-detail/order-detail?orderId=${encodeURIComponent(this.data.orderId)}` });
  },

  goHome() {
    const role = authService.getRole();
    const workHome = {
      [ROLE.MANAGER]: '/pages/area-manager/index',
      [ROLE.STAFF]: '/pages/laundry-staff/index',
      [ROLE.ADMIN]: '/pages/admin-entry/index',
    }[role];
    if (workHome) return wx.reLaunch({ url: workHome });
    wx.switchTab({ url: '/pages/home/index' });
  },

  goOrders() {
    if (authService.getRole() !== ROLE.USER) return this.goHome();
    wx.navigateTo({ url: '/pages/order-list/order-list' });
  },
});
