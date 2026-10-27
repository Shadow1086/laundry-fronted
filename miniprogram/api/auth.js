const { request } = require('../utils/request');
const env = require('../config/env');

function login(payload) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/auth/login`, method: 'POST', data: payload });
}

module.exports = { login };
