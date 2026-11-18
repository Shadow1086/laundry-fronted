const ENV = {
  development: { apiBaseUrl: 'http://127.0.0.1:8080' },
  production:  { apiBaseUrl: 'https://api.shepishi.cn' },
};

// 当前使用真实后端环境。
const currentEnv = 'production';

module.exports = ENV[currentEnv];
