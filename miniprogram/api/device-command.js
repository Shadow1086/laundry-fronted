const { request } = require('../utils/request');
const env = require('../config/env');

function sendDeviceCommand(payload) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/device/command`, method: 'POST', data: payload });
}

function confirmDepositOpened(orderId, cabinetOperationId) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/device/command/${encodeURIComponent(String(cabinetOperationId))}/confirm-open?orderId=${encodeURIComponent(String(orderId))}`,
    method: 'POST',
  });
}

module.exports = { confirmDepositOpened, sendDeviceCommand };
