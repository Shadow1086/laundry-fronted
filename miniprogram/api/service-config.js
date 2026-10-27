const { request } = require('../utils/request');
const env = require('../config/env');

const baseUrl = `${env.apiBaseUrl}/api/miniapp/config`;

function getBusinessStatus() {
  return request({
    url: `${baseUrl}/business-status`,
    method: 'GET',
  });
}

function getServicePhones() {
  return request({
    url: `${baseUrl}/phones`,
    method: 'GET',
  });
}

module.exports = { getBusinessStatus, getServicePhones };
