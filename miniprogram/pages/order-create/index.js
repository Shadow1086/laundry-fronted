const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');
const orderService = require('../../services/order-service');
const orderApi = require('../../api/order');
const env = require('../../config/env');
const errorUtil = require('../../utils/error');

const stores = cabinetService.getStores();

Page({
  data: {
    ...orderService.getInitialOrderState(),
    stores,
    selectedStore: stores[0].name,
    selectedStoreInfo: stores[0],
    cabinetType: 'small',
    showSelection: false,
    confirmMode: false,
    submitState: 'idle',
    inlineMessage: '',
  },

  onLoad() { authService.requireLogin(); },

  selectGroup(e) {
    const activeGroupKey = e.currentTarget.dataset.key;
    if (activeGroupKey === this.data.activeGroupKey) return;
    this.setData({
      activeGroupKey,
      activeGroup: this.data.clothingGroups.find((group) => group.key === activeGroupKey),
      scrollIntoView: '',
    }, () => this.setData({ scrollIntoView: 'item-panel-top' }));
  },

  changeCount(id, delta) {
    const groups = orderService.changeItemCount(this.data.clothingGroups, id, delta);
    const summary = orderService.summarizeClothing(groups, this.data.activeGroupKey);
    this.setData({ ...summary, inlineMessage: '' });
  },
  increase(e) { this.changeCount(e.currentTarget.dataset.id, 1); },
  decrease(e) { this.changeCount(e.currentTarget.dataset.id, -1); },
  removeClothing(e) {
    const summary = orderService.summarizeClothing(orderService.removeItem(this.data.clothingGroups, e.currentTarget.dataset.id), this.data.activeGroupKey);
    this.setData({ ...summary, inlineMessage: '' });
  },

  toggleSelection() { this.setData({ showSelection: !this.data.showSelection, confirmMode: false }); },
  continueAdding() { this.setData({ showSelection: false, confirmMode: false, scrollIntoView: 'item-panel-top' }); },
  beginConfirm() {
    if (!this.data.selectedCount) {
      this.setData({ inlineMessage: '请至少选择一件衣物后再确认下单', showSelection: false, confirmMode: false });
      return;
    }
    this.setData({ confirmMode: true, showSelection: false, inlineMessage: '' });
  },
  backToEdit() { this.setData({ confirmMode: false, inlineMessage: '' }); },
  async submitOrder() {
    const user = authService.getCurrentUser() || {};
    if (!user.telephone) {
      this.setData({ inlineMessage: '请先在登录页完成手机号授权，绑定后才能提交订单', confirmMode: false });
      return;
    }
    if (!this.data.selectedCount || this.data.submitState === 'loading' || this.data.submitState === 'success') return;
    this.setData({ submitState: 'loading', inlineMessage: '正在提交订单…' });
    const payload = {
      items: this.data.selectedItems.map((item) => ({ id: item.id, count: item.count, price: item.price })),
      storeName: this.data.selectedStore,
      cabinetType: this.data.cabinetType,
      estimate: Number(this.data.estimate),
    };
    try {
      if (env.demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 450));
      } else {
        await orderApi.createOrder(payload);
      }
      this.setData({ submitState: 'success', inlineMessage: '' });
      wx.showToast({ title: '订单已提交', icon: 'success', duration: 2000 });
      setTimeout(() => {
        this.setData({
          ...orderService.getInitialOrderState(),
          submitState: 'idle',
          confirmMode: false,
          showSelection: false,
          inlineMessage: '',
        });
      }, 2000);
    } catch (error) {
      this.setData({ submitState: 'error', inlineMessage: errorUtil.getMessage(error, '订单提交失败，请稍后重试') });
    }
  },
  chooseLocation() {
    wx.showActionSheet({
      itemList: this.data.stores.map((store) => store.name),
      success: (res) => {
        const selectedStoreInfo = this.data.stores[res.tapIndex];
        this.setData({ selectedStore: selectedStoreInfo.name, selectedStoreInfo });
      },
    });
  },
  previewItemImage(e) {
    const { current, images } = e.currentTarget.dataset;
    if (!current || !images || !images.length) return;
    wx.previewImage({ current, urls: images });
  },
  selectCabinetType(e) { this.setData({ cabinetType: e.currentTarget.dataset.type }); },
});
