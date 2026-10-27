const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');
const errorUtil = require('../../utils/error');
const session = require('../../utils/session');
const { ROLE } = require('../../constants/role');
const orderApi = require('../../api/order');
const membershipApi = require('../../api/membership');
const locationService = require('../../services/location-service');

const ROLE_LANDING = {
  [ROLE.ADMIN]: '/pages/admin-entry/index',
  [ROLE.MANAGER]: '/pages/area-manager/index',
  [ROLE.STAFF]: '/pages/laundry-staff/index',
};

Page({
  data: {
    userName: '洛克用户',
    phoneBound: false,
    selectedStore: 'GZ明祥园点',
    stores: cabinetService.getStores(),
    authenticated: false,
    authVisible: false,
    agreementAccepted: false,
    loginLoading: false,
    loginMessage: '',
    handlingOrder: false,
    storesLoading: true,
    storesMessage: '',
    selectedStoreInfo: null,
    isMember: false,
  },

  onLoad() {
    this.syncAuthState();
  },

  onShow() {
    this.syncAuthState();
    this.loadHomeStores();
  },

  async loadHomeStores() {
    this.setData({ storesLoading: true, storesMessage: '' });
    try {
      const stores = await cabinetService.loadStores();
      const visibleStores = stores.slice(0, 3);
      const selectedStoreInfo = visibleStores.find((store) => store.name === this.data.selectedStore) || visibleStores[0] || null;
      this.setData({
        stores: visibleStores,
        selectedStore: selectedStoreInfo ? selectedStoreInfo.name : '',
        selectedStoreInfo,
        storesLoading: false,
        storesMessage: stores.length ? '' : '暂无柜机数据',
      });
    } catch (error) {
      this.setData({ stores: [], storesLoading: false, storesMessage: '柜机数据加载失败，请稍后重试' });
    }
  },

  syncAuthState() {
    const authenticated = authService.isAuthenticated();
    const shouldPrompt = session.consumeAuthPrompt();
    this.setData({
      authenticated,
      authVisible: authenticated ? false : (this.data.authVisible || shouldPrompt),
    });
    if (authenticated) {
      wx.showTabBar({ animation: true });
      this.syncUser();
      // 登录接口返回的用户可能只有 id/角色，首页显示前再拉取完整资料。
      authService.fetchAndSaveProfile().then(() => this.syncUser()).catch(() => {});
      this.checkPendingOrder();
    } else {
      // 首页允许游客浏览，只有点击受保护功能时才强制授权。
      wx.showTabBar({ animation: false });
    }
  },

  async checkPendingOrder() {
    if (this.data.handlingOrder) return;
    this.setData({ handlingOrder: true });
    try {
      const result = await orderApi.getOrders({
        page: 1,
        pageSize: 20,
        orderStatus: 'WAITING_PAYMENT_PICKUP',
      });
      const records = Array.isArray(result) ? result : (result && (result.records || result.orders)) || [];
      const pendingOrders = records
        .filter((item) => (item.orderStatus || item.status) === 'WAITING_PAYMENT_PICKUP')
        .map((rawOrder) => ({
          ...rawOrder,
          id: rawOrder.orderId ?? rawOrder.id,
          orderId: rawOrder.orderId ?? rawOrder.id,
          cabinetId: rawOrder.returnCabinetId ?? rawOrder.cabinetId ?? rawOrder.storeId,
          payableAmount: rawOrder.payableAmount ?? rawOrder.finalPayableAmount ?? rawOrder.finalPrice ?? rawOrder.amount,
        }))
        .filter((order) => order.orderId);
      if (!pendingOrders.length) return;

      const ordersWithPayment = await Promise.all(pendingOrders.map(async (order) => ({
        order,
        paid: await this._resolvePaidStatus(order),
      })));
      const unpaidOrders = ordersWithPayment.filter((item) => !item.paid).map((item) => item.order);
      const paidOrders = ordersWithPayment.filter((item) => item.paid).map((item) => item.order);
      const showingUnpaid = unpaidOrders.length > 0;
      const targetOrders = showingUnpaid ? unpaidOrders : paidOrders;
      const totalAmount = unpaidOrders.reduce((sum, order) => {
        const amount = Number(order.payableAmount);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0);
      const promptKey = `${showingUnpaid ? 'unpaid' : 'paid'}:${targetOrders.map((order) => order.orderId).join(',')}:${totalAmount}`;
      if (this._lastPromptOrderKey === promptKey) return;
      this._lastPromptOrderKey = promptKey;
      wx.showModal({
        title: showingUnpaid ? '订单待付款' : '衣物待取',
        content: showingUnpaid
          ? `你有 ${unpaidOrders.length} 个订单待支付，合计应付 ¥${this._formatAmount(totalAmount)}。`
          : `你有 ${paidOrders.length} 个订单已支付，衣物正在柜中等待领取。`,
        confirmText: showingUnpaid ? '去付款' : '去取衣',
        cancelText: '稍后处理',
        success: ({ confirm }) => {
          if (!confirm) return;
          if (targetOrders.length > 1) {
            wx.navigateTo({ url: '/pages/order-list/order-list?filter=active' });
            return;
          }
          if (showingUnpaid) {
            this.payPendingOrder(targetOrders[0]);
            return;
          }
          this.promptNearbyCabinet(targetOrders[0]);
        },
      });
    } catch (error) {
      console.warn('[home] pending order check failed', error);
    } finally {
      this.setData({ handlingOrder: false });
    }
  },

  async _resolvePaidStatus(order) {
    const paymentStatus = String(order.paymentStatus || '').toUpperCase();
    if (paymentStatus) return ['PAID', 'SUCCESS'].includes(paymentStatus);
    if (order.paid === true || order.isPaid === true) return true;
    try {
      const payment = await orderApi.getLatestPayment(order.orderId);
      return String(payment && (payment.transactionStatus || payment.paymentStatus) || '').toUpperCase() === 'SUCCESS'
        || String(payment && payment.paymentStatus || '').toUpperCase() === 'PAID';
    } catch (error) {
      return false;
    }
  },

  _formatAmount(value) {
    if (value === null || value === undefined || value === '') return '--';
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : String(value);
  },

  async payPendingOrder(order) {
    if (this.data.handlingOrder) return;
    this.setData({ handlingOrder: true });
    const idempotencyKey = `payment-${order.orderId}-${Date.now()}`;
    try {
      const payment = await orderApi.prepayOrder(order.orderId, idempotencyKey);
      if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
        throw new Error('支付参数不完整，请稍后重试');
      }
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(payment.timeStamp),
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType || 'RSA',
          paySign: payment.paySign,
          success: resolve,
          fail: reject,
        });
      });
      wx.showToast({ title: '支付成功', icon: 'success' });
      this._lastPromptOrderKey = '';
      wx.navigateTo({
        url: `/pages/order-detail/order-detail?orderId=${encodeURIComponent(String(order.orderId))}`,
      });
    } catch (error) {
      const message = error && /cancel/i.test(error.errMsg || '')
        ? '已取消支付'
        : errorUtil.getMessage(error, '支付失败，请重试');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ handlingOrder: false });
    }
  },

  async promptNearbyCabinet(order) {
    const detailUrl = `/pages/order-detail/order-detail?orderId=${encodeURIComponent(String(order.orderId))}`;
    try {
      const location = await locationService.getCurrentLocation();
      const stores = await cabinetService.loadStores(location);
      const target = stores.find((store) => String(store.id) === String(order.cabinetId));
      if (!target || !Number.isFinite(target.distanceMeters)) {
        wx.navigateTo({ url: detailUrl });
        return;
      }
      const distance = target.distanceMeters < 1000
        ? `${Math.round(target.distanceMeters)} 米`
        : `${(target.distanceMeters / 1000).toFixed(1)} 公里`;
      wx.showModal({
        title: '衣物可以领取',
        content: `${target.name} 距离你约 ${distance}，现在去取衣吗？`,
        confirmText: '去取衣',
        cancelText: '查看详情',
        success: ({ confirm }) => {
          if (!confirm) return wx.navigateTo({ url: detailUrl });
          wx.navigateTo({
            url: `/pages/scan-cabinet/scan-cabinet?mode=pickup&orderId=${encodeURIComponent(String(order.orderId))}&cabinetType=${encodeURIComponent(order.cabinetType || 'small')}`,
          });
        },
      });
    } catch (error) {
      wx.navigateTo({ url: detailUrl });
    }
  },

  dismissAuth() {
    this.setData({ authVisible: false, loginMessage: '', agreementAccepted: false });
  },

  changeAgreement(e) {
    this.setData({ agreementAccepted: e.detail.value.includes('agree') });
  },

  openAgreement(e) {
    wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` });
  },

  requestAgreement() {
    this.setData({ loginMessage: '请阅读并自行勾选同意用户服务协议和隐私政策' });
  },

  requireAuth() {
    if (this.data.authenticated) return true;
    this.setData({
      authVisible: true,
      loginMessage: '需要先授权手机号，才能使用这项服务',
    });
    return false;
  },

  openOrders() {
    if (!this.requireAuth()) return;
    wx.navigateTo({ url: '/pages/order-list/order-list' });
  },

  syncUser() {
    const user = authService.getCurrentUser() || {};
    const name = user.username || '洛克用户';
    this.setData({
      userName: name,
      phoneBound: Boolean(user.telephone),
      isMember: Boolean(user.isMember),
    });
  },

  handlePhoneNumber(e) {
    if (!this.data.agreementAccepted) return this.requestAgreement();
    const phoneCode = e.detail && e.detail.code;
    if (!phoneCode) {
      const detail = e.detail || {};
      const reason = detail.errno ? `手机号授权失败（${detail.errno}）` : (detail.errMsg || '手机号授权被取消');
      this.setData({ loginMessage: reason });
      return;
    }
    wx.login({
      success: (loginRes) => this.loginWithCodes(loginRes.code, phoneCode),
      fail: () => this.setData({ loginMessage: '微信登录失败，请重试' }),
    });
  },

  async loginWithCodes(loginCode, phoneCode) {
    if (!this.data.agreementAccepted || !loginCode || !phoneCode || this.data.loginLoading) return;
    this.setData({ loginLoading: true, loginMessage: '' });
    try {
      await authService.login({ loginCode, phoneCode });
      this.setData({ authVisible: false, agreementAccepted: false });
      const pendingLaunch = session.consumePendingLaunch();
      if (pendingLaunch) {
        wx.reLaunch({ url: require('../../utils/scan-context').resolvePendingLaunch(pendingLaunch, authService.getRole()) });
        return;
      }
      const landing = ROLE_LANDING[authService.getRole()];
      if (landing) {
        wx.reLaunch({ url: landing });
        return;
      }
      this.setData({ loginLoading: false, authenticated: true });
      wx.showTabBar({ animation: true });
      this.syncUser();
    } catch (error) {
      this.setData({
        loginLoading: false,
        loginMessage: errorUtil.getMessage(error, '登录失败，请稍后再试'),
      });
    }
  },

  scanCabinet(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset.type) || 'deposit';
    if (type === 'deposit') {
      wx.switchTab({ url: '/pages/order-create/index' });
      return;
    }
    if (!this.requireAuth()) return;
    wx.navigateTo({ url: '/pages/scan-cabinet/scan-cabinet?mode=pickup' });
  },
  chooseLocation() {
    if (!this.data.stores.length) {
      wx.showToast({ title: '暂无可切换的柜机', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: this.data.stores.map((store) => store.name),
      success: (res) => {
        const selectedStoreInfo = this.data.stores[res.tapIndex];
        this.setData({ selectedStore: selectedStoreInfo.name, selectedStoreInfo });
      },
    });
  },
  selectStore(e) {
    const selectedStoreInfo = this.data.stores.find((store) => store.name === e.currentTarget.dataset.name);
    this.setData({ selectedStore: selectedStoreInfo.name, selectedStoreInfo });
    wx.showToast({ title: '已切换营业点', icon: 'none' });
  },
  openCabinetMap() { wx.navigateTo({ url: '/pages/cabinet-map/index' }); },
  async showMembership() {
    if (!this.requireAuth() || this.data.handlingOrder) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '购买会员年卡',
        content: '会员年卡 ¥36，有效期一年，购买后下单自动享受会员价。',
        confirmText: '立即购买',
        cancelText: '暂不购买',
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;
    this.setData({ handlingOrder: true });
    try {
      const payment = await membershipApi.purchase(`membership-${Date.now()}`);
      if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
        throw new Error('会员支付参数不完整，请稍后重试');
      }
      await new Promise((resolve, reject) => wx.requestPayment({
        timeStamp: payment.timeStamp,
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType || 'RSA',
        paySign: payment.paySign,
        success: resolve,
        fail: reject,
      }));
      await authService.fetchAndSaveProfile();
      this.syncUser();
      wx.showToast({ title: '会员购买成功', icon: 'success' });
    } catch (error) {
      const message = error && /cancel/i.test(error.errMsg || '') ? '已取消购买' : errorUtil.getMessage(error, '会员购买失败，请重试');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ handlingOrder: false });
    }
  },
  showPromotion() { wx.showToast({ title: '活动即将上线，敬请期待', icon: 'none' }); },

});
