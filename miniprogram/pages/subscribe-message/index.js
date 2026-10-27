const { ORDER_TEMPLATE_IDS } = require('../../constants/subscribe-template');

Page({
  data: {
    orderNo: '',
    requesting: false,
    resultMessage: '',
  },

  onLoad(options) {
    this.setData({ orderNo: options.orderNo || '' });
  },

  requestSubscribe() {
    if (this.data.requesting) return;
    if (typeof wx.requestSubscribeMessage !== 'function') {
      this.setData({ resultMessage: '当前微信版本暂不支持消息订阅' });
      return;
    }

    this.setData({ requesting: true, resultMessage: '' });
    wx.requestSubscribeMessage({
      tmplIds: ORDER_TEMPLATE_IDS,
      success: (res) => {
        console.log('[subscribe-message] authorization result', res);
        const accepted = ORDER_TEMPLATE_IDS.filter((id) => res[id] === 'accept').length;
        this.setData({
          requesting: false,
          resultMessage: accepted ? `已授权 ${accepted} 条消息通知` : '你暂未授权消息通知，可在微信设置中重新开启',
        });
      },
      fail: (error) => {
        console.warn('[subscribe-message] authorization failed', error);
        this.setData({ requesting: false, resultMessage: '消息授权未完成，请稍后重试' });
      },
    });
  },

  skip() {
    this.goOrders();
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/order-list/order-list' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },
});
