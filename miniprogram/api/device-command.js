const { request } = require('../utils/request');
const env = require('../config/env');

function sendDeviceCommand(payload) {
  return request({ url: `${env.apiBaseUrl}/device/command`, method: 'POST', data: payload });
}

module.exports = { sendDeviceCommand };
