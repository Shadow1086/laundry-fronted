const authService = require('./services/auth-service');
const session = require('./utils/session');
const { ROLE } = require('./constants/role');
const scanContext = require('./utils/scan-context');

const ROLE_LANDING = {
  [ROLE.ADMIN]: '/pages/admin-entry/index',
  [ROLE.MANAGER]: '/pages/area-manager/index',
  [ROLE.STAFF]: '/pages/laundry-staff/index',
};
const PUBLIC_ROUTES = ['pages/home/index', 'pages/legal/index', 'pages/order-create/index', session.AUTH_ROUTE];

App({
  onLaunch: function () {
    this.globalData = {
      // 后续接入洗衣业务服务时，在这里配置对应的云环境 ID。
      env: "",
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
    this._guardColdStart();
  },

  // 冷启动兜底：App.onShow 早于 Page.onLoad，此时页面栈还是空的，
  // 拿不到当前路由，所以改用启动参数判断（分享卡片、扫码直达等场景）。
  _guardColdStart: function () {
    const options = typeof wx.getLaunchOptionsSync === 'function' ? wx.getLaunchOptionsSync() : {};
    const path = options.path || '';
    if (this._handleScanLaunch(options)) return;
    if (authService.isAuthenticated() && path === 'pages/home/index') {
      const landing = ROLE_LANDING[authService.getRole()];
      if (landing) {
        wx.reLaunch({ url: landing });
        return;
      }
    }
    if (path && !PUBLIC_ROUTES.includes(path) && !authService.isAuthenticated()) {
      session.savePendingLaunch(scanContext.buildLaunchUrl({
        path,
        query: options.query,
      }));
      authService.redirectToLogin();
    }
  },

  _handleScanLaunch: function (options) {
    const scanned = scanContext.parse(options);
    if (scanned.type === 'cabinet-scene') {
      session.consumePendingLaunch();
      session.savePendingCabinetScene(scanned.value);
      const url = '/pages/order-create/index';
      wx.reLaunch({ url });
      return true;
    }
    if (scanned.type === 'cabinet') {
      session.consumePendingLaunch();
      const url = scanContext.buildLaunchUrl({
        path: 'pages/order-create/index',
        query: { cabinetId: scanned.value, cabinetName: scanned.name },
      });
      wx.reLaunch({ url });
      return true;
    }
    if (scanned.type === 'order-scene') {
      session.consumePendingCabinetScene();
      session.consumePendingLaunch();
      const target = scanContext.buildLaunchUrl({ path: 'pages/order-detail/order-detail', query: { scanSceneKey: scanned.value } });
      const url = authService.isAuthenticated()
        ? scanContext.resolvePendingLaunch(target, authService.getRole()) : target;
      if (authService.isAuthenticated()) { wx.reLaunch({ url }); } else { session.savePendingLaunch(url); authService.redirectToLogin(); }
      return true;
    }
    return false;
  },

  onShow: function (options) {
    // 首次 onShow 已由 onLaunch 处理；后续扫码唤起要使用本次参数。
    if (this._initialShowHandled) {
      const scanLaunchScenes = [1011, 1012, 1013, 1047, 1048, 1049];
      if (options && scanLaunchScenes.includes(Number(options.scene)) && this._handleScanLaunch(options)) return;
    } else {
      this._initialShowHandled = true;
    }
    // 从后台切回前台时复查会话；页面自身仍会在 onLoad/onShow 再次校验。
    const route = session.currentRoute();
    if (!route || PUBLIC_ROUTES.includes(route)) return;
    if (!authService.isAuthenticated()) {
      authService.redirectToLogin();
    }
  },
});
