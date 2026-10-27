const orderApi = require('../../api/order');
const authService = require('../../services/auth-service');
const errorUtil = require('../../utils/error');
const serviceConfigApi = require('../../api/service-config');
const locationService = require('../../services/location-service');

Page({
  data: {
    items: [],
    cabinetType: 'small',
    storeName: '',
    totalCount: 0,
    estimate: 0,
    submitting: false,
    idempotencyKey: '',
    requestId: '',
    memberPriceApplied: false,
    // 原始 payload 用于提交
    _payload: null,
  },

  onLoad(options) {
    if (!authService.requireLogin()) return;
    // 接收从 order-create 传来的序列化参数
    try {
      const payload = JSON.parse(decodeURIComponent(options.payload));
      const validItems = Array.isArray(payload.items)
        && payload.items.length
        && payload.items.every((item) => item.categoryId && Number(item.count) > 0);
      if (!payload.cabinetId || !validItems || !['small', 'large'].includes(payload.cabinetType)) {
        throw new Error('missing order fields');
      }
      const totalCount = payload.items.reduce((sum, item) => sum + Number(item.count), 0);
      this.setData({
        items: payload.items,
        cabinetType: payload.cabinetType,
        storeName: payload.storeName,
        estimate: payload.estimate,
        totalCount,
        memberPriceApplied: Boolean(payload.memberPriceApplied),
        idempotencyKey: `miniapp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        requestId: `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        _payload: payload,
      });
    } catch (e) {
      wx.showToast({ title: '参数异常', icon: 'none' });
      wx.navigateBack();
    }
  },

  cancel() {
    wx.navigateBack();
  },

  confirmClosedBusiness() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '当前已停止营业',
        content: '停业期间仍可继续下单并投放衣物，是否继续？',
        confirmText: '继续下单',
        cancelText: '暂不下单',
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false),
      });
    });
  },

  confirmTooFar(distanceMeters) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '距离提示',
        content: `当前距离柜机约 ${Math.round(Number(distanceMeters))} 米，距离过远，请检查附近柜机并确认是否开柜。`,
        confirmText: '确认开柜',
        cancelText: '返回修改',
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false),
      });
    });
  },

  async confirmOrder() {
    if (this.data.submitting) return;
    if (!this.data._payload) { wx.showToast({ title: '订单参数无效，请返回重试', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      const payload = this.data._payload;
      const locationCheck = await locationService.checkCurrentDistance({
        latitude: payload.cabinetLatitude,
        longitude: payload.cabinetLongitude,
      });
      if (!locationCheck.allowed) {
        if (locationCheck.reason !== 'too-far') {
          throw new Error('柜机位置暂不可用，无法确认距离');
        }
        if (!(await this.confirmTooFar(locationCheck.distanceMeters))) {
          this.setData({ submitting: false });
          return;
        }
      }
      let result;
      try {
        result = await serviceConfigApi.getBusinessStatus();
      } catch (error) {
        throw new Error('营业状态获取失败，请稍后重试');
      }
      const businessStatus = Number(result && typeof result === 'object'
        ? (result.businessStatus ?? result.status)
        : result);
      if (!Number.isFinite(businessStatus)) throw new Error('营业状态数据异常');
      if (businessStatus === 0 && !(await this.confirmClosedBusiness())) {
        this.setData({ submitting: false });
        return;
      }
      const res = await orderApi.createOrder({
          requestId: this.data.requestId,
          cabinetId: payload.cabinetId,
          compartmentSize: payload.cabinetType.toUpperCase(),
          items: payload.items.map((item) => ({
            categoryId: item.categoryId,
            quantity: Number(item.count),
            remark: '',
          })),
          userLatitude: locationCheck.userLocation.latitude,
          userLongitude: locationCheck.userLocation.longitude,
      }, this.data.idempotencyKey);
      const responseData = res && res.data !== undefined ? res.data : res;
      const order = responseData && typeof responseData === 'object'
        ? (responseData.order || responseData.orderInfo || responseData.result || responseData)
        : responseData;
      const orderId = order && typeof order === 'object'
        ? (order.orderId || order.id || order.order?.orderId || order.order?.id)
        : order;
      if (!orderId) {
        wx.showToast({ title: '下单成功，请在订单列表查看', icon: 'none', duration: 2000 });
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/order-list/order-list' });
        }, 1000);
        return;
      }
      this.setData({ submitting: false });
      wx.showModal({
        title: '下单成功',
        content: '订单已创建，是否现在打开柜门投放衣物？',
        confirmText: '立即开柜',
        cancelText: '稍后再开',
        success: ({ confirm }) => {
          if (!confirm) {
            wx.redirectTo({ url: '/pages/order-list/order-list' });
            return;
          }
          wx.redirectTo({
            // 距离已在本页确认，带上本次定位结果，开柜页无需再次弹出距离确认。
            url: `/pages/command-result/command-result?mode=deposit&orderId=${encodeURIComponent(String(orderId))}&cabinetType=${this.data.cabinetType}&cabinetLatitude=${encodeURIComponent(String(payload.cabinetLatitude))}&cabinetLongitude=${encodeURIComponent(String(payload.cabinetLongitude))}&distanceConfirmed=1&userLatitude=${encodeURIComponent(String(locationCheck.userLocation.latitude))}&userLongitude=${encodeURIComponent(String(locationCheck.userLocation.longitude))}`,
          });
        },
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: errorUtil.getMessage(e, '提交失败，请重试'), icon: 'none' });
    }
  },
});
