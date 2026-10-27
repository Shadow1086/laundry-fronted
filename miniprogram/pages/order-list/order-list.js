const orderApi = require('../../api/order');
const authService = require('../../services/auth-service');
const STATUS = require('../../constants/order-status');

const STATUS_CONFIG = {
  PENDING_DEPOSIT:        { label: '待存衣',     tone: 'blue' },
  WAITING_PICKUP:         { label: '待管理员取', tone: 'purple' },
  WASHING:                { label: '洗护中',     tone: 'orange' },
  WAITING_RETURN:         { label: '待返柜',     tone: 'orange' },
  WAITING_PAYMENT_PICKUP: { label: '待付款取衣', tone: 'green' },
  COMPLETED:              { label: '已完成',     tone: 'gray' },
  CANCELLED:              { label: '已取消',     tone: 'gray' },
  REWASHING:              { label: '返洗中',     tone: 'orange' },
  EXCEPTION:              { label: '异常待处理', tone: 'red' },
  [STATUS.CREATED]:        { label: '待洗护',     tone: 'blue' },
  [STATUS.CLEANING]:       { label: '洗护中',     tone: 'orange' },
  [STATUS.READY]:          { label: '待取衣',     tone: 'green' },
  [STATUS.COMPLETED]:      { label: '已完成',     tone: 'gray' },
  [STATUS.PENDING_PICKUP]: { label: '待管理员取', tone: 'purple' },
};

const FINISHED_STATUSES = ['COMPLETED', 'CANCELLED', STATUS.COMPLETED];

const FILTERS = [
  { key: 'all',    label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done',   label: '已完成' },
];

const LEGACY_STATUS_MAP = {
  CREATED: STATUS.CREATED,
  CLEANING: STATUS.CLEANING,
  READY: STATUS.READY,
  PENDING_PICKUP: STATUS.PENDING_PICKUP,
  COMPLETED: STATUS.COMPLETED,
};

function normalizeStatus(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  return LEGACY_STATUS_MAP[upper] || upper || raw;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text
    .replace('T', ' ')
    .replace(/\.\d+(?=Z?$)/, '')
    .replace(/Z$/, '')
    .replace(/-/g, '/');
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getOrderTimestamp(order) {
  return [
    order.updatedAt,
    order.updateAt,
    order.updateTime,
    order.modifiedAt,
    order.lastUpdatedAt,
    order.createdAt,
    order.createAt,
    order.createdTime,
  ].map(parseTimestamp).find((value) => value > 0) || 0;
}

Page({
  data: {
    loading: true,
    orders: [],
    filtered: [],
    filters: FILTERS,
    activeFilter: 'all',
  },

  onLoad(options) {
    if (!authService.requireLogin()) return;
    const filter = FILTERS.some((item) => item.key === options.filter) ? options.filter : 'all';
    this.setData({ activeFilter: filter });
  },

  onShow() {
    if (!authService.isAuthenticated()) return;
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders(this.data.activeFilter).then(() => wx.stopPullDownRefresh());
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      const list = await orderApi.getOrders({ page: 1, pageSize: 100 });
      const ordersData = Array.isArray(list) ? list : (list && (list.records || list.orders)) || [];
      const orders = ordersData.map((order, index) => {
        const orderId = order.orderId ?? order.id ?? order.orderID ?? order.order_id;
        const status = normalizeStatus(order.orderStatus || order.status);
        const updatedAt = getOrderTimestamp(order);
        const estimatedAmount = order.estimatedPayableAmount
          ?? order.estimatedOriginalAmount
          ?? order.estimatedAmount
          ?? order.estimate
          ?? order.estimatedPrice;
        const payableAmount = order.finalPayableAmount
          ?? order.payableAmount
          ?? order.finalPrice
          ?? order.amount;
        const deliveryCodeInfo = this._getDeliveryCodeInfo(order, status);
        return {
          ...order,
          id: orderId,
          orderId,
          orderNo: String(order.orderNo || ''),
          locationLabel: order.cabinetName || order.storeName || order.serviceSiteName || '洗衣订单',
          status,
          statusConfig: STATUS_CONFIG[status] || { label: status || '状态未知', tone: 'gray' },
          itemsSummary: this._summarizeItems(order.items),
          categorySummary: order.categoryDetail || this._summarizeCategories(order.items),
          createdAtLabel: this._formatDateTime(order.createAt || order.createdAt || order.createTime),
          updatedAtLabel: updatedAt ? this._formatDateTime(updatedAt) : '时间未知',
          updatedAt,
          _sourceIndex: index,
          estimateLabel: this._formatPrice(estimatedAmount),
          payableLabel: this._formatPrice(payableAmount),
          hasPayableAmount: payableAmount !== null && payableAmount !== undefined && payableAmount !== '',
          ...deliveryCodeInfo,
        };
      });
      orders.sort((left, right) => (
        right.updatedAt - left.updatedAt
        || right._sourceIndex - left._sourceIndex
      ));
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
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key });
    this._applyFilter(key, this.data.orders);
  },

  goDetail(e) {
    const orderId = e.currentTarget.dataset.orderId;
    if (orderId === undefined || orderId === null || orderId === '' || orderId === 'undefined' || orderId === 'null') {
      wx.showToast({ title: '订单信息无效，请刷新列表', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderId=${encodeURIComponent(String(orderId))}`,
    });
  },

  _summarizeItems(items) {
    if (!items || !items.length) return '暂无明细';
    const preview = items.slice(0, 3).map(i => `${i.name} ×${i.count}`).join('、');
    return items.length > 3 ? preview + '…' : preview;
  },

  _summarizeCategories(items) {
    if (!Array.isArray(items) || !items.length) return '暂无衣物明细';
    const names = items.map((item) => item.categoryName || item.name || item.clothingName).filter(Boolean);
    const uniqueNames = [...new Set(names)];
    return uniqueNames.length > 3
      ? `${uniqueNames.slice(0, 3).join('、')}等 ${items.length} 类`
      : uniqueNames.join('、') || '暂无衣物明细';
  },

  _formatPrice(value) {
    if (value === null || value === undefined || value === '') return '--';
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : String(value);
  },

  _getDeliveryCodeInfo(order, status) {
    const deliveryCode = String(order.deliveryCode || '').trim();
    const expiryValue = order.deliveryCodeExpiresAt
      || order.deliveryCodeExpireAt
      || order.deliveryCodeExpiredAt
      || order.pickupCodeExpiresAt;
    const expiryTime = expiryValue
      ? new Date(String(expiryValue).replace('T', ' ').replace(/\.\d+/, '').replace(/-/g, '/')).getTime()
      : 0;
    const explicitlyExpired = order.deliveryCodeExpired === true
      || order.isDeliveryCodeExpired === true
      || order.deliveryCodeValid === false
      || String(order.deliveryCodeStatus || '').toUpperCase() === 'EXPIRED';
    const finished = FINISHED_STATUSES.includes(status);
    const expired = explicitlyExpired || finished || (expiryTime > 0 && expiryTime <= Date.now());
    const hasValidDeliveryCode = /^[A-Za-z0-9]{4}$/.test(deliveryCode) && !expired;
    return {
      deliveryCodeLabel: hasValidDeliveryCode ? deliveryCode : '----',
      hasValidDeliveryCode,
    };
  },

  _formatDateTime(value) {
    const timestamp = parseTimestamp(value);
    if (!timestamp) return value ? String(value) : '时间未知';
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  _applyFilter(key, orders) {
    let filtered;
    if (key === 'active') {
      filtered = orders.filter((order) => !FINISHED_STATUSES.includes(order.status));
    } else if (key === 'done') {
      filtered = orders.filter((order) => FINISHED_STATUSES.includes(order.status));
    } else {
      filtered = orders;
    }
    this.setData({ filtered });
  },
});
