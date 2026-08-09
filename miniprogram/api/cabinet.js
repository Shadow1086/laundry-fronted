const { request } = require('../utils/request');
const env = require('../config/env');

function getCabinets(params) {
  return request({ url: `${env.apiBaseUrl}/cabinets`, method: 'GET', data: params });
}

module.exports = { getCabinets };
