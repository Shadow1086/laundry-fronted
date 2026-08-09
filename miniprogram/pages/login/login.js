const authService = require('../../services/auth-service');
const env = require('../../config/env');
const errorUtil = require('../../utils/error');

Page({
  data: {
    phoneAuthorized: false,
    loading: false,
    message: '',
    messageType: '',
    demoMode: Boolean(env.demoMode),
  },

  onLoad() {
    if (authService.isAuthenticated()) {
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  handleLoginTap() {
    if (this.data.demoMode) this.demoLogin();
  },

  handlePhoneNumber(e) {
    if (this.data.demoMode) {
      this.demoLogin();
      return;
    }
    const phoneCode = e.detail && e.detail.code;
    if (!phoneCode) {
      this.setData({ phoneAuthorized: false, message: '手机号授权被取消，授权后才能完成登录', messageType: 'error' });
      return;
    }
    this.setData({ phoneAuthorized: true, message: '手机号已授权，正在安全登录…', messageType: 'info' });
    wx.login({
      success: (loginRes) => this.loginWithCodes(loginRes.code, phoneCode),
      fail: () => this.setData({ message: '微信登录失败，请重试', messageType: 'error' }),
    });
  },

  async loginWithCodes(loginCode, phoneCode) {
    if (!loginCode || !phoneCode || this.data.loading) return;
    this.setData({ loading: true, message: '正在登录…', messageType: 'info' });
    try {
      await authService.login({
        loginCode,
        phoneCode,
      });
      wx.switchTab({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ loading: false, phoneAuthorized: false, message: errorUtil.getMessage(error, '登录失败，请稍后再试'), messageType: 'error' });
    }
  },

  demoLogin() {
    if (!this.data.demoMode || this.data.loading) return;
    authService.saveDemoSession();
    wx.showToast({ title: '演示登录成功', icon: 'success' });
    setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 300);
  },
});
