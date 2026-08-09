const ENV = {
  // 开发工具中可使用显式演示登录，真实接口失败时不会自动降级。
  development: { apiBaseUrl: '', demoMode: true },
  production: { apiBaseUrl: '', demoMode: false },
};

const currentEnv = 'development';

module.exports = ENV[currentEnv];
