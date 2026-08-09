const orderApi = require('../../api/order');
const authService = require('../../services/auth-service');
const STATUS = require('../../constants/order-status');

const STATUS_CONFIG = {
  [STATUS.CREATED]:   { label: '待洗护', tone: 'blue' },
  [STATUS.CLEANING]:  { label: '洗护中', tone: 'orange' },
  [STATUS.READY]:     { label: '待取衣', tone: 'green' },
  [STATUS.COMPLETED]: { label: '已完成', tone: 'gray' },
};

const MOCK_ORDERS = [
  {
    id: 'ORD-20260801-0012',
    status: STATUS.READY,
    createdAt: '2026-08-01 10:15',
    estimate: 86,
    storeName: '万达广场店',
    cabinetType: 'large',
    items: [
      { name: '衬衫', categoryName: '上装', count: 2, price: 20 },
      { name: '西裤', categoryName: '下装', count: 1, price: 18 },
      { name: '外套', categoryName: '上装', count: 1, price: 28 },
    ],
  },
  {
    id: 'ORD-20260728-0008',
    status: STATUS.CLEANING,
    createdAt: '2026-07-28 14:32',
    estimate: 54,
    storeName: '合生汇店',
    cabinetType: 'small',
    items: [
      { name: 'T恤', categoryName: '上装', count: 3, price: 12 },
      { name: '牛仔裤', categoryName: '下装', count: 1, price: 18 },
    ],
  },
  {
    id: 'ORD-20260720-0005',
    status: STATUS.CREATED,
    createdAt: '2026-07-20 09:04',
    estimate: 32,
    storeName: '万达广场店',
    cabinetType: 'small',
    items: [
      { name: '衬衫', categoryName: '上装', count: 2, price: 20 },
    ],
  },
  {
    id: 'ORD-20260710-0003',
    status: STATUS.COMPLETED,
    createdAt: '2026-07-10 11:20',
    estimate: 120,
    storeName: '合生汇店',
    cabinetType: 'large',
    items: [
      { name: '西装上衣', categoryName: '上装', count: 1, price: 48 },
      { name: '西裤', categoryName: '下装', count: 1, price: 18 },
      { name: '被套', categoryName: '家居床品', count: 1, price: 38 },
      { name: '枕套', categoryName: '家居床品', count: 2, price: 16 },
    ],
  },
];

const FILTERS = [
  { key: 'all',    label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done',   label: '已完成' },
];

Page({
  data: {
    loading: true,
    orders: [],
    filtered: [],
    filters: FILTERS,
    activeFilter: 'all',
  },

  onLoad() {
    authService.requireLogin();
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().then(() => wx.stopPullDownRefresh());
  },

  async loadOrders() {
    this.setData({ loading: true });
    // TODO: 替换为真实 API：const list = await orderApi.getOrders();
    await new Promise(r => setTimeout(r, 600));
    const list = MOCK_ORDERS;
    try {
      const orders = (list || []).map(o => ({
        ...o,
        statusConfig: STATUS_CONFIG[o.status] || { label: o.status, tone: 'gray' },
        itemsSummary: this._summarizeItems(o.items),
      }));
      this.setData({ orders });
      this._applyFilter(this.data.activeFilter, orders);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  tapFilter(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeFilter: key });
    this._applyFilter(key, this.data.orders);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` });
  },

  _summarizeItems(items) {
    if (!items || !items.length) return '暂无明细';
    const preview = items.slice(0, 3).map(i => `${i.name} ×${i.count}`).join('、');
    return items.length > 3 ? preview + '…' : preview;
  },

  _applyFilter(key, orders) {
    let filtered;
    if (key === 'active') {
      filtered = orders.filter(o => [STATUS.CREATED, STATUS.CLEANING, STATUS.READY].includes(o.status));
    } else if (key === 'done') {
      filtered = orders.filter(o => o.status === STATUS.COMPLETED);
    } else {
      filtered = orders;
    }
    this.setData({ filtered });
  },
});
