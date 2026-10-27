const authService = require('../../services/auth-service');
const errorUtil = require('../../utils/error');
const { ROLE } = require('../../constants/role');
const session = require('../../utils/session');

// 登录成功后各角色的落地页；admin 走管理员入口，由用户自行选择进入哪个管理端。
const ROLE_LANDING = {
  [ROLE.ADMIN]: '/pages/admin-entry/index',
  [ROLE.MANAGER]: '/pages/area-manager/index',
  [ROLE.STAFF]: '/pages/laundry-staff/index',
};

Page({
  data: {
    phoneAuthorized: false,
    agreementAccepted: false,
    loading: false,
    message: '',
    messageType: '',
  },

  onLoad() {
    if (authService.isAuthenticated()) {
      this._redirectByRole();
    }
  },

  _redirectByRole() {
    const pendingLaunch = session.consumePendingLaunch();
    if (pendingLaunch) {
      wx.reLaunch({ url: require('../../utils/scan-context').resolvePendingLaunch(pendingLaunch, authService.getRole()) });
      return;
    }
    const landing = ROLE_LANDING[authService.getRole()];
    if (landing) {
      wx.reLaunch({ url: landing });
    } else {
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  handlePhoneNumber(e) {
    if (!this.data.agreementAccepted) return this.requestAgreement();
    const phoneCode = e.detail && e.detail.code;
    if (!phoneCode) {
      const detail = e.detail || {};
      const reason = detail.errno ? `手机号授权失败（${detail.errno}）` : (detail.errMsg || '手机号授权被取消');
      this.setData({ phoneAuthorized: false, message: reason, messageType: 'error' });
      return;
    }
    this.setData({ phoneAuthorized: true, message: '手机号已授权，正在安全登录…', messageType: 'info' });
    wx.login({
      success: (loginRes) => this.loginWithCodes(loginRes.code, phoneCode),
      fail: () => this.setData({ message: '微信登录失败，请重试', messageType: 'error' }),
    });
  },

  async loginWithCodes(loginCode, phoneCode) {
    if (!this.data.agreementAccepted || !loginCode || !phoneCode || this.data.loading) return;
    this.setData({ loading: true, message: '正在登录…', messageType: 'info' });
    try {
      await authService.login({
        loginCode,
        phoneCode,
      });
      this._redirectByRole();
    } catch (error) {
      this.setData({ loading: false, phoneAuthorized: false, message: errorUtil.getMessage(error, '登录失败，请稍后再试'), messageType: 'error' });
    }
  },

  changeAgreement(e) {
    this.setData({ agreementAccepted: e.detail.value.includes('agree') });
  },
  openAgreement(e) {
    wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` });
  },
  requestAgreement() {
    this.setData({ message: '请阅读并自行勾选同意用户服务协议和隐私政策', messageType: 'error' });
  },
  browseHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },
});
