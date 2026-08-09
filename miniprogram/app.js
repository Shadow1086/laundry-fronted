const authService = require('./services/auth-service');

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
  },

  onShow: function () {
    // 所有业务页共享这一层兜底，页面自身仍会在 onLoad 再次校验。
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const current = pages.length ? pages[pages.length - 1] : null;
    if (current && current.route !== 'pages/login/login' && !authService.isAuthenticated()) {
      authService.redirectToLogin();
    }
  },
});
