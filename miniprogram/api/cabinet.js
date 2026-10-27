const { request } = require('../utils/request');
const env = require('../config/env');

function getCabinets(params) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/cabinets`, method: 'GET', data: params });
}

function getCabinetByScanScene(scanSceneKey) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/cabinets/by-scan-scene/${encodeURIComponent(String(scanSceneKey || ''))}`, method: 'GET' });
}

module.exports = { getCabinets, getCabinetByScanScene };
