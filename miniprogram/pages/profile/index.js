const authService = require('../../services/auth-service');
const errorUtil = require('../../utils/error');
const orderApi = require('../../api/order');
const serviceConfigApi = require('../../api/service-config');
const membershipApi = require('../../api/membership');

Page({
  data: {
    userName: '洛克用户',
    phone: '未绑定手机号',
    phoneLoading: false,
    membershipSubmitting: false,
    isMember: false,
    membershipExpiresAt: '',
    servicePhoneLoading: false,
    contactPanelVisible: false,
    servicePhones: [],
    canAccessAdmin: false,
    orderStats: [
      { label: '待存衣', count: 0, icon: '/assets/icons/package-open.svg', tone: 'stat-blue', filter: 'active' },
      { label: '待取件', count: 0, icon: '/assets/icons/truck.svg', tone: 'stat-lilac', filter: 'active' },
      { label: '洗护中', count: 0, icon: '/assets/icons/washing-machine.svg', tone: 'stat-amber', filter: 'active' },
      { label: '待取衣', count: 0, icon: '/assets/icons/scan-line.svg', tone: 'stat-slate', filter: 'active' },
      { label: '已完成', count: 0, icon: '/assets/icons/circle-check.svg', tone: 'stat-green', filter: 'done' },
    ],
    functions: [
      { label: '手机号', icon: '/assets/icons/smartphone.svg', tone: 'function-blue', isPhone: true },
      { label: '账号信息', icon: '/assets/icons/user-round-cog.svg', tone: 'function-lilac' },
      { label: '扫码取衣', icon: '/assets/icons/scan-line.svg', tone: 'function-slate' },
      { label: '优惠券', icon: '/assets/icons/ticket-percent.svg', tone: 'function-amber' },
      { label: '门店地图', icon: '/assets/icons/map-pinned.svg', tone: 'function-teal' },
      { label: '会员权益', icon: '/assets/icons/crown.svg', tone: 'function-rose' },
      { label: '联系客服', icon: '/assets/icons/headset.svg', tone: 'function-green' },
    ],
  },

  onLoad() { if (!authService.requireLogin()) return; },
  onShow() {
    if (!authService.isAuthenticated()) return;
    this.syncUser();
    authService.fetchAndSaveProfile().then(() => this.syncUser()).catch(() => {});
    this.loadOrderStats();
    const app = getApp();
    if (app.globalData && app.globalData.openServiceContactOnShow) {
      app.globalData.openServiceContactOnShow = false;
      this.callServicePhone();
    }
  },
  syncUser() {
    const user = authService.getCurrentUser() || {};
    const name = user.username || '洛克用户';
    this.setData({
      userName: name,
      phone: authService.maskTelephone(user.telephone),
      // 普通用户不展示管理员入口，避免点进去再被拦回来。
      canAccessAdmin: authService.canAccessAdmin(),
      isMember: Boolean(user.isMember),
      membershipExpiresAt: this.formatMembershipExpiry(user.membershipExpiresAt),
    });
  },
  formatMembershipExpiry(value) {
    if (!value) return '';
    const text = String(value).replace('T', ' ');
    return text.length >= 10 ? text.slice(0, 16) : text;
  },
  async loadOrderStats() {
    try {
      const result = await orderApi.getOrders({ page: 1, pageSize: 100 });
      const orders = Array.isArray(result) ? result : (result && (result.records || result.orders)) || [];
      const count = (...statuses) => orders.filter((order) => statuses.includes(order.orderStatus || order.status)).length;
      const orderStats = this.data.orderStats.map((item) => ({ ...item }));
      orderStats[0].count = count('PENDING_DEPOSIT', 'created');
      orderStats[1].count = count('WAITING_PICKUP', 'pending_pickup');
      orderStats[2].count = count('WASHING', 'WAITING_RETURN', 'REWASHING', 'cleaning');
      orderStats[3].count = count('WAITING_PAYMENT_PICKUP', 'ready');
      orderStats[4].count = count('COMPLETED', 'completed');
      this.setData({ orderStats });
    } catch (error) {
      console.warn('[profile] order statistics unavailable', error);
    }
  },
  goOrders(e) {
    const filter = e && e.currentTarget && e.currentTarget.dataset.filter;
    wx.navigateTo({ url: `/pages/order-list/order-list${filter ? `?filter=${filter}` : ''}` });
  },
  goAdmin() {
    if (!authService.canAccessAdmin()) return;
    wx.navigateTo({ url: '/pages/admin-entry/index' });
  },
  async openMember() {
    if (this.data.membershipSubmitting) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '购买会员年卡',
        content: '会员年卡 ¥36，有效期一年，购买后下单自动享受会员价。',
        confirmText: '立即购买',
        cancelText: '暂不购买',
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;
    this.setData({ membershipSubmitting: true });
    wx.showLoading({ title: '正在创建订单' });
    try {
      const payment = await membershipApi.purchase(`membership-${Date.now()}`);
      wx.hideLoading();
      if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
        throw new Error('会员支付参数不完整，请稍后重试');
      }
      await new Promise((resolve, reject) => wx.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType || 'RSA',
        paySign: payment.paySign,
        success: resolve,
        fail: reject,
      }));
      await authService.fetchAndSaveProfile();
      this.syncUser();
      wx.showToast({ title: '会员购买成功', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      const message = error && /cancel/i.test(error.errMsg || '') ? '已取消购买' : errorUtil.getMessage(error, '会员购买失败，请重试');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ membershipSubmitting: false });
    }
  },
  editProfile() { wx.navigateTo({ url: '/pages/profile-edit/index' }); },
  scanCabinet() { wx.navigateTo({ url: '/pages/order-list/order-list?filter=active' }); },
  async callServicePhone() {
    if (this.data.servicePhoneLoading) return;
    this.setData({ servicePhoneLoading: true });
    try {
      const result = await serviceConfigApi.getServicePhones();
      const records = Array.isArray(result)
        ? result
        : (result && (result.phones || result.list || result.records)) || [];
      const phones = records
        .map((item) => ({
          phone: String(item && (item.phone || item.phoneNumber || item.telephone || item.mobile || item.number) || '').trim(),
          contactType: String(item && item.contactType || '').trim().toUpperCase(),
          serviceSiteName: String(item && (item.serviceSiteName || item.siteName || item.storeName) || '').trim(),
          description: String(item && (item.description || item.name || item.title) || '').trim(),
        }))
        .filter((item) => item.phone);
      if (!phones.length) {
        wx.showToast({ title: '客服电话暂未配置', icon: 'none' });
        return;
      }
      this.setData({ servicePhones: phones, contactPanelVisible: true });
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '客服电话加载失败'), icon: 'none' });
    } finally {
      this.setData({ servicePhoneLoading: false });
    }
  },
  closeContactPanel() {
    this.setData({ contactPanelVisible: false });
  },
  noop() {},
  dialServicePhone(e) {
    const item = this.data.servicePhones[Number(e.currentTarget.dataset.index)];
    if (item && item.phone) wx.makePhoneCall({ phoneNumber: item.phone });
  },
  handlePhoneNumber(e) {
    const detail = e.detail || {};
    const phoneCode = detail.code;
    if (!phoneCode) {
      const reason = detail.errno ? `手机号授权失败（${detail.errno}）` : (detail.errMsg || '手机号授权被取消');
      wx.showToast({ title: reason, icon: 'none' });
      return;
    }
    this.setData({ phoneLoading: true });
    wx.login({
      success: async (loginRes) => {
        if (!loginRes.code) {
          this.setData({ phoneLoading: false });
          wx.showToast({ title: '微信登录凭证为空，请重试', icon: 'none' });
          return;
        }
        try {
          await authService.login({ loginCode: loginRes.code, phoneCode });
          this.syncUser();
          wx.showToast({ title: '手机号绑定成功', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: errorUtil.getMessage(error, '手机号绑定失败，请重试'), icon: 'none' });
        } finally {
          this.setData({ phoneLoading: false });
        }
      },
      fail: (error) => {
        this.setData({ phoneLoading: false });
        wx.showToast({ title: errorUtil.getMessage(error, '微信登录失败，请重试'), icon: 'none' });
      },
    });
  },
  onFunction(e) {
    const label = e.currentTarget.dataset.label;
    if (label === '扫码取衣') return this.scanCabinet();
    if (label === '联系客服') return this.callServicePhone();
    if (label === '门店地图') return wx.navigateTo({ url: '/pages/cabinet-map/index' });
    if (label === '账号信息') return wx.navigateTo({ url: '/pages/profile-edit/index' });
    if (label === '会员权益') return this.openMember();
    if (label === '优惠券') return wx.showToast({ title: '暂无可用优惠券', icon: 'none' });
    wx.showToast({ title: `${label}功能准备中`, icon: 'none' });
  },
});
