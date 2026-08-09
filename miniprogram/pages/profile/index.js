const authService = require('../../services/auth-service');

Page({
  data: {
    userName: '易净用户',
    phone: '未绑定手机号',
    orderStats: [
      { label: '待入柜', count: 0, icon: '＋', tone: 'stat-blue' },
      { label: '待取件', count: 0, icon: '↗', tone: 'stat-lilac' },
      { label: '清洗中', count: 1, icon: '◌', tone: 'stat-amber' },
      { label: '待取衣', count: 0, icon: '◇', tone: 'stat-slate' },
      { label: '已完成', count: 8, icon: '✓', tone: 'stat-green' },
    ],
    functions: [
      { label: '绑定手机号', icon: '☎', tone: 'function-blue' },
      { label: '账号找回', icon: '↻', tone: 'function-lilac' },
      { label: '扫码取衣', icon: '⌗', tone: 'function-slate' },
      { label: '优惠券申请', icon: '◉', tone: 'function-amber' },
      { label: '门店地图', icon: '⌖', tone: 'function-teal' },
      { label: '会员权益', icon: '♛', tone: 'function-rose' },
      { label: '联系客服', icon: '✆', tone: 'function-green' },
    ],
  },

  onLoad() { authService.requireLogin(); },
  onShow() { if (authService.isAuthenticated()) this.syncUser(); },
  syncUser() {
    const user = authService.getCurrentUser() || {};
    const name = user.username || '易净用户';
    this.setData({ userName: name, phone: authService.maskTelephone(user.telephone) });
  },
  goOrders() { wx.navigateTo({ url: '/pages/order-list/order-list' }); },
  goAdmin() { wx.navigateTo({ url: '/pages/admin-entry/index' }); },
  openMember() { wx.showToast({ title: '会员办理即将开放', icon: 'none' }); },
  editProfile() { wx.showToast({ title: '手机号由登录授权同步', icon: 'none' }); },
  scanCabinet() { wx.scanCode({ onlyFromCamera: true, fail: () => wx.showToast({ title: '请使用真实柜码扫码', icon: 'none' }) }); },
  onFunction(e) {
    const label = e.currentTarget.dataset.label;
    if (label === '扫码取衣') return this.scanCabinet();
    if (label === '绑定手机号') return wx.showToast({ title: this.data.phone === '未绑定手机号' ? '请重新授权手机号' : '手机号已绑定', icon: 'none' });
    if (label === '联系客服') return wx.makePhoneCall({ phoneNumber: '400-000-0000' });
    wx.showToast({ title: `${label}功能准备中`, icon: 'none' });
  },
});
