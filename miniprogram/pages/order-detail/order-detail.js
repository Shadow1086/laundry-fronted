const authService = require('../../services/auth-service');
const orderApi = require('../../api/order');
const env = require('../../config/env');

const STATUS_MAP = {
  created:   { label: '待入柜', hint: '请前往柜机扫码存入衣物', icon: '＋', color: 'blue' },
  cleaning:  { label: '清洗中', hint: '衣物正在洗护，请耐心等待', icon: '◌', color: 'amber' },
  ready:     { label: '待取衣', hint: '衣物已洗好，请扫码取回', icon: '◇', color: 'green' },
  completed: { label: '已完成', hint: '订单已完成，感谢您的信任', icon: '✓', color: 'slate' },
};

const STEPS = [
  { key: 'created',   name: '已下单' },
  { key: 'cleaning',  name: '清洗中' },
  { key: 'ready',     name: '待取衣' },
  { key: 'completed', name: '已完成' },
];

const STEP_ORDER = ['created', 'cleaning', 'ready', 'completed'];

const DEMO_ORDER = {
  id: 'ORD-20260808-001',
  status: 'cleaning',
  storeName: 'GZ明祥园点',
  cabinetType: 'small',
  estimate: '50.00',
  finalPrice: null,
  items: [
    { name: '外套', count: 1, price: 32, categoryName: '上装' },
    { name: '裤装', count: 1, price: 22, categoryName: '下装' },
  ],
  createdAt: '2026-08-08 14:30',
  cleanedAt: null,
  completedAt: null,
};

Page({
  data: { order: null, statusInfo: null, progressSteps: [], loading: true },

  onLoad(options) {
    if (!authService.requireLogin()) return;
    this.loadOrder(options.id);
  },

  async loadOrder(id) {
    try {
      let order;
      if (env.demoMode) {
        await new Promise((r) => setTimeout(r, 200));
        order = { ...DEMO_ORDER, id: id || DEMO_ORDER.id };
      } else {
        order = await orderApi.getOrderById(id);
      }
      const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.created;
      const activeIdx = STEP_ORDER.indexOf(order.status);
      const progressSteps = STEPS.map((step, i) => ({
        ...step,
        done: i < activeIdx,
        active: i === activeIdx,
      }));
      this.setData({ order, statusInfo, progressSteps, loading: false });
    } catch {
      this.setData({ loading: false });
      wx.showToast({ title: '订单信息加载失败', icon: 'none' });
    }
  },

  scanPickup() {
    wx.scanCode({
      onlyFromCamera: true,
      success: () => wx.showToast({ title: '已识别柜机，取衣中', icon: 'success' }),
      fail: () => wx.showToast({ title: '请对准柜机二维码扫描', icon: 'none' }),
    });
  },

  applyRewash() {
    wx.showModal({
      title: '申请反洗',
      content: '确认对本单衣物申请重新洗护？商家确认后将安排取件。',
      confirmText: '确认申请',
      confirmColor: '#286e4f',
      success: (res) => {
        if (res.confirm) wx.showToast({ title: '申请已提交', icon: 'success' });
      },
    });
  },
});
