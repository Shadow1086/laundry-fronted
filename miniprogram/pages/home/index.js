const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');

Page({
  data: { userName: '易净用户', selectedStore: 'GZ明祥园点', stores: cabinetService.getStores() },

  onLoad() {
    if (!authService.requireLogin()) return;
    this.syncUser();
  },

  onShow() {
    if (authService.isAuthenticated()) this.syncUser();
  },

  syncUser() {
    const user = authService.getCurrentUser() || {};
    const name = user.username || '易净用户';
    this.setData({ userName: name });
  },

  scanCabinet(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset.type) || 'deposit';
    const labels = { deposit: '存衣物', pickup: '取走衣物', rewash: '申请反洗' };
    const label = labels[type] || '开柜';
    wx.scanCode({
      onlyFromCamera: true,
      success: () => wx.showToast({ title: `已识别柜机，${label}中`, icon: 'success' }),
      fail: () => wx.showToast({ title: '可在下单页选择投放柜机', icon: 'none' }),
    });
  },
  chooseLocation() {
    wx.showActionSheet({
      itemList: this.data.stores.map((store) => store.name),
      success: (res) => this.setData({ selectedStore: this.data.stores[res.tapIndex].name }),
    });
  },
  selectStore(e) {
    this.setData({ selectedStore: e.currentTarget.dataset.name });
    wx.showToast({ title: '已切换营业点', icon: 'none' });
  },
  showMembership() { wx.showToast({ title: '会员服务即将上线', icon: 'none' }); },
  showPromotion() { wx.showToast({ title: '活动即将上线，敬请期待', icon: 'none' }); },
});
