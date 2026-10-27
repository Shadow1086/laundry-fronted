const authService = require('../../services/auth-service');
const { ROLE } = require('../../constants/role');
const scanContext = require('../../utils/scan-context');

Page({
  data: {
    canManager: false,
    canStaff: false,
  },

  onLoad(options) {
    const context = scanContext.parse(options);
    this._pendingOrderId = context.type === 'order' ? context.value : '';
  },

  // 用 onShow 而非 onLoad：从子页返回时重新校验，账号被降权后入口会同步消失。
  onShow() {
    if (!authService.requireAdmin()) return;
    const role = authService.getRole();
    if (this._pendingOrderId && role === ROLE.MANAGER) {
      this._openOrderForRole('/pages/area-manager/index');
      return;
    }
    if (this._pendingOrderId && role === ROLE.STAFF) {
      this._openOrderForRole('/pages/laundry-staff/index');
      return;
    }
    this.setData({
      canManager: authService.hasRole(ROLE.MANAGER),
      canStaff: authService.hasRole(ROLE.STAFF),
    });
  },

  goAreaManager() {
    if (!authService.requireRole(ROLE.MANAGER)) return;
    this._openOrderForRole('/pages/area-manager/index');
  },

  goLaundryStaff() {
    if (!authService.requireRole(ROLE.STAFF)) return;
    this._openOrderForRole('/pages/laundry-staff/index');
  },

  _openOrderForRole(path) {
    const pendingOrderId = this._pendingOrderId;
    const query = pendingOrderId
      ? `?orderId=${encodeURIComponent(pendingOrderId)}`
      : '';
    this._pendingOrderId = '';
    const navigate = pendingOrderId ? wx.reLaunch : wx.navigateTo;
    navigate({ url: `${path}${query}` });
  },
});
