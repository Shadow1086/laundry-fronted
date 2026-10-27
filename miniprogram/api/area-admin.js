const { request } = require('../utils/request');
const env = require('../config/env');

const baseUrl = `${env.apiBaseUrl}/api/miniapp/area-admin`;

function getAreaAdminOrders(params) {
  return request({
    url: `${baseUrl}/orders`,
    method: 'GET',
    data: params,
  });
}

function getAreaAdminCabinets(internalStage) {
  if (!internalStage) {
    return Promise.reject(new Error('订单内部阶段不能为空'));
  }
  return request({
    url: `${baseUrl}/cabinets`,
    method: 'GET',
    data: { internalStage },
  });
}

function getAreaAdminOrderById(orderId) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${baseUrl}/orders/${encodeURIComponent(String(orderId))}`,
    method: 'GET',
  });
}

function getLabelPrintData(orderId) {
  if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
  return request({ url: `${baseUrl}/orders/${encodeURIComponent(String(orderId))}/label-print-data`, method: 'GET' });
}

function recordLabelPrint(orderId, payload) {
  if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
  const requestId = payload && payload.clientRequestId ? payload.clientRequestId : `label-print-${orderId}-${Date.now()}`;
  return request({
    url: `${baseUrl}/orders/${encodeURIComponent(String(orderId))}/label-print`,
    method: 'POST', data: payload || {}, header: { 'Idempotency-Key': requestId },
  });
}

function pickUpOrder(orderId, idempotencyKey) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${baseUrl}/orders/pickup/${encodeURIComponent(String(orderId))}`,
    method: 'GET',
    header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  });
}

function printOrderLabel(orderId, idempotencyKey) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${baseUrl}/orders/${encodeURIComponent(String(orderId))}/print`,
    method: 'POST',
    header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  });
}

// 后端会分配返柜格口并开门，当前接口返回 Result<Void>。
function openReturnCompartment(orderId, payload, idempotencyKey) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${baseUrl}/${encodeURIComponent(String(orderId))}/return/open`,
    method: 'POST',
    data: payload,
    header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  });
}

// 待后端实现：确认衣物已经返柜并关门，由后端推进订单状态。
function confirmReturnOrder(orderId, operationId, idempotencyKey) {
  if (orderId === undefined || orderId === null || orderId === '') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  if (!operationId) return Promise.reject(new Error('返柜操作 ID 不能为空'));
  return request({
    url: `${baseUrl}/orders/${encodeURIComponent(String(orderId))}/return/confirm`,
    method: 'POST',
    data: { operationId },
    header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  });
}

module.exports = {
  confirmReturnOrder,
  getAreaAdminCabinets,
  getAreaAdminOrders,
  getAreaAdminOrderById,
  getLabelPrintData,
  openReturnCompartment,
  pickUpOrder,
  printOrderLabel,
  recordLabelPrint,
};
