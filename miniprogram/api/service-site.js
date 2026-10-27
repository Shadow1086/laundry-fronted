const { request } = require('../utils/request');
const env = require('../config/env');

function getServiceSites() {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/service-sites`, method: 'GET' });
}

module.exports = { getServiceSites };
