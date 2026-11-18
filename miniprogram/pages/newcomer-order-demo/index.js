const newcomerTour = require('../../services/newcomer-tour');
const DEMO_ORDER = require('../../data/newcomer-demo-order');

Page(newcomerTour.attachPage({
  data: { order: DEMO_ORDER },
  showCancelDemo() {
    wx.showToast({ title: '教程订单不可取消', icon: 'none' });
  },
}, 'orderDemo'));
