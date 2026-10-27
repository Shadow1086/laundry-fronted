const { request, uploadFiles } = require('../utils/request');
const env = require('../config/env');

function createOrder(payload, idempotencyKey) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders`,
    method: 'POST',
    timeout: 15000,
    data: payload,
    header: { 'Idempotency-Key': idempotencyKey },
  });
}

function previewOrderPrice(payload, idempotencyKey) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/preview`,
    method: 'POST',
    timeout: 15000,
    data: payload,
    header: { 'Idempotency-Key': idempotencyKey || `preview-${Date.now()}` },
  });
}

function getOrders(params) {
  return request({ url: `${env.apiBaseUrl}/api/miniapp/orders`, method: 'GET', data: params });
}

function cancelOrder(payload, idempotencyKey) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/remove`,
    method: 'POST',
    data: payload,
    header: { 'Idempotency-Key': idempotencyKey },
  });
}

function getLatestPayment(orderId) {
  if (orderId === undefined || orderId === null || orderId === '' || orderId === 'undefined' || orderId === 'null') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/${encodeURIComponent(String(orderId))}/payments/latest`,
    method: 'GET',
  });
}

function prepayOrder(orderId, idempotencyKey) {
  if (orderId === undefined || orderId === null || orderId === '' || orderId === 'undefined' || orderId === 'null') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/${encodeURIComponent(String(orderId))}/prepay`,
    method: 'POST',
    header: { 'Idempotency-Key': idempotencyKey },
  }).then(normalizePaymentParams);
}

function normalizePaymentParams(response) {
  let payment = response;
  // 兼容 request 已解包或接口仍返回 data/payment 包装的响应。
  for (let depth = 0; depth < 3 && payment && typeof payment === 'object'; depth += 1) {
    if (payment.timeStamp || payment.nonceStr || payment.package || payment.packageStr || payment.paySign) break;
    if (payment.data && typeof payment.data === 'object') {
      payment = payment.data;
    } else if (payment.payment && typeof payment.payment === 'object') {
      payment = payment.payment;
    } else {
      break;
    }
  }
  if (!payment || typeof payment !== 'object') return payment;
  const packageValue = payment.package
    || payment.packageStr
    || payment.packageValue
    || payment.prepayPackage;
  return {
    ...payment,
    timeStamp: String(payment.timeStamp ?? payment.timestamp ?? payment.time_stamp ?? ''),
    nonceStr: String(payment.nonceStr ?? payment.nonce_str ?? ''),
    package: packageValue === undefined ? '' : String(packageValue),
    paySign: String(payment.paySign ?? payment.pay_sign ?? ''),
  };
}

function pickUpOrder(orderId, deliveryCode, idempotencyKey, location) {
  if (orderId === undefined || orderId === null || orderId === '' || orderId === 'undefined' || orderId === 'null') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  if (!idempotencyKey) {
    return Promise.reject(new Error('幂等键不能为空'));
  }
  const normalizedDeliveryCode = String(deliveryCode || '').trim().toUpperCase();
  if (normalizedDeliveryCode && !/^[A-Za-z0-9]{4}$/.test(normalizedDeliveryCode)) {
    return Promise.reject(new Error('请输入4位英数字取货码'));
  }
  const query = /^[A-Za-z0-9]{4}$/.test(normalizedDeliveryCode)
    ? `?deliveryCode=${encodeURIComponent(normalizedDeliveryCode)}`
    : '';
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/pickup/${encodeURIComponent(String(orderId))}${query}`,
    method: 'POST',
    data: location || undefined,
    header: { 'Idempotency-Key': idempotencyKey },
  });
}

function pickUpByDeliveryCode(orderId, deliveryCode, idempotencyKey, location) {
  // 后端只提供 POST /pickup/{orderId}?deliveryCode=...，代取也必须先匹配订单。
  return pickUpOrder(orderId, deliveryCode, idempotencyKey, location);
}

function confirmPickupOpened(orderId, cabinetOperationId) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/pickup/${encodeURIComponent(String(orderId))}/confirm-open?cabinetOperationId=${encodeURIComponent(String(cabinetOperationId))}`,
    method: 'POST',
  });
}

function requestRewash(orderId, payload, idempotencyKey, imagePaths) {
  if (orderId === undefined || orderId === null || orderId === '' || orderId === 'undefined' || orderId === 'null') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  const images = Array.isArray(imagePaths) ? imagePaths : [];
  if (!images.length) return Promise.reject(new Error('请上传至少1张问题图片'));
  return uploadFiles({
    url: `${env.apiBaseUrl}/api/miniapp/orders/${encodeURIComponent(String(orderId))}/rewash-requests`,
    filePaths: images,
    name: 'images',
    formData: {
      reason: String(payload && payload.reason || ''),
      cabinetId: String(payload && payload.cabinetId !== undefined && payload.cabinetId !== null ? payload.cabinetId : ''),
      compartmentSize: String(payload && payload.compartmentSize || '').toUpperCase(),
    },
    compress: true,
    compressQuality: 75,
    header: { 'Idempotency-Key': idempotencyKey },
  });
}

function prepareRewashDeposit(orderId, cabinetId, compartmentSize, idempotencyKey) {
  if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
  const query = cabinetId && compartmentSize
    ? `?cabinetId=${encodeURIComponent(String(cabinetId))}&compartmentSize=${encodeURIComponent(String(compartmentSize).toUpperCase())}`
    : '';
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/${encodeURIComponent(String(orderId))}/rewash-deposit${query}`,
    method: 'POST',
    header: { 'Idempotency-Key': idempotencyKey },
  });
}

function getOrderById(id) {
  if (id === undefined || id === null || id === '' || id === 'undefined' || id === 'null') {
    return Promise.reject(new Error('订单 ID 不能为空'));
  }
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/${encodeURIComponent(String(id))}`,
    method: 'GET',
  });
}

function getOrderByScanScene(scanSceneKey) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/orders/by-scan-scene/${encodeURIComponent(String(scanSceneKey || ''))}`,
    method: 'GET',
  });
}

module.exports = {
  cancelOrder,
  confirmPickupOpened,
  createOrder,
  getLatestPayment,
  getOrders,
  getOrderById,
  getOrderByScanScene,
  pickUpByDeliveryCode,
  pickUpOrder,
  prepayOrder,
  requestRewash,
  prepareRewashDeposit,
  previewOrderPrice,
};
