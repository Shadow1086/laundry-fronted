const authService = require('../../services/auth-service');
const errorUtil = require('../../utils/error');

Page({
  data: {
    username: '',
    mobile: '',
    phoneBound: false,
    saving: false,
    phoneLoading: false,
    message: '',
  },

  async onLoad() {
    if (!authService.requireLogin()) return;
    await authService.fetchAndSaveProfile();
    this.loadUser();
  },

  loadUser() {
    const user = authService.getCurrentUser() || {};
    this.setData({
      username: user.username || user.nickname || '',
      mobile: user.telephone || user.mobile || '',
      phoneBound: Boolean(user.telephone || user.mobile),
    });
  },

  handleUsernameInput(e) {
    this.setData({ username: e.detail.value, message: '' });
  },

  handlePhoneNumber(e) {
    const phoneCode = e.detail && e.detail.code;
    if (!phoneCode) {
      const detail = e.detail || {};
      this.setData({ message: detail.errMsg || '手机号授权被取消' });
      return;
    }
    this.setData({ phoneLoading: true, message: '' });
    wx.login({
      success: async (loginRes) => {
        if (!loginRes.code) {
          this.setData({ phoneLoading: false, message: '微信登录凭证为空，请重试' });
          return;
        }
        try {
          const result = await authService.login({ loginCode: loginRes.code, phoneCode });
          const user = result.user || authService.getCurrentUser() || {};
          this.setData({
            mobile: user.telephone || user.mobile || '',
            phoneBound: Boolean(user.telephone || user.mobile),
            message: '手机号已更新，点击保存资料完成修改',
          });
        } catch (error) {
          this.setData({ message: errorUtil.getMessage(error, '手机号绑定失败，请重试') });
        } finally {
          this.setData({ phoneLoading: false });
        }
      },
      fail: (error) => this.setData({ phoneLoading: false, message: errorUtil.getMessage(error, '微信登录失败，请重试') }),
    });
  },

  async saveProfile() {
    const username = String(this.data.username || '').trim();
    const mobile = String(this.data.mobile || '').replace(/\s/g, '');
    if (!username) {
      this.setData({ message: '请输入用户名' });
      return;
    }
    if (!/^1\d{10}$/.test(mobile)) {
      this.setData({ message: '请先授权一个有效的手机号' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true, message: '' });
    try {
      await authService.updateProfile({ username, mobile });
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 450);
    } catch (error) {
      this.setData({ saving: false, message: errorUtil.getMessage(error, '保存失败，请稍后重试') });
    }
  },

  cancel() { wx.navigateBack(); },
});
