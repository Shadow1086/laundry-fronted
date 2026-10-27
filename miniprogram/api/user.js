const { request } = require('../utils/request');
const env = require('../config/env');

function getMe() {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/user/me`, method: 'GET' });
}

function updateMe(payload) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/user/me`, method: 'PATCH', data: payload });
}

module.exports = { getMe, updateMe };
