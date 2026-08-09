const { request } = require('../utils/request');
const env = require('../config/env');

function createOrder(payload) {
  return request({ url: `${env.apiBaseUrl}/orders`, method: 'POST', data: payload });
}

function getOrders(params) {
  return request({ url: `${env.apiBaseUrl}/orders`, method: 'GET', data: params });
}

function getOrderById(id) {
  return request({ url: `${env.apiBaseUrl}/orders/${id}`, method: 'GET' });
}

module.exports = { createOrder, getOrders, getOrderById };
