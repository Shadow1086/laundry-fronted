const { request, uploadFiles } = require('../utils/request');
const env = require('../config/env');

function getStaffOrders(params) {
    return request({
        url: `${env.apiBaseUrl}/api/miniapp/staff/orders`,
        method: 'GET',
        data: params,
    });
}

function getStaffOrderById(orderId) {
    if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
    return request({
        url: `${env.apiBaseUrl}/api/miniapp/staff/orders/${encodeURIComponent(String(orderId))}`,
        method: 'GET',
    });
}

// 验衣照片批量上传：单请求携带全部文件，后端逐张保存。
// requestId 同时作为表单字段和 Idempotency-Key 头发送，兼容两种幂等取法。
function uploadInspectionImages(orderId, filePaths, requestId) {
    if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
    const images = Array.isArray(filePaths) ? filePaths : [];
    return uploadFiles({
        url: `${env.apiBaseUrl}/api/miniapp/staff/check/${encodeURIComponent(String(orderId))}`,
        filePaths: images,
        name: 'images',
        // 验衣照片上传前压缩，降低弱网环境下的请求体积。
        compress: true,
        compressQuality: 75,
        formData: requestId ? { requestId } : {},
        header: requestId ? { 'Idempotency-Key': requestId } : {},
        allowEmpty: true,
    });
}

function completeWash(orderId, idempotencyKey) {
    if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
    return request({
        url: `${env.apiBaseUrl}/api/miniapp/staff/orders/${encodeURIComponent(String(orderId))}/complete`,
        method: 'POST',
        header: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    });
}

function getLabelPrintData(orderId) {
    if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
    return request({
        url: `${env.apiBaseUrl}/api/miniapp/staff/orders/${encodeURIComponent(String(orderId))}/label-print-data`,
        method: 'GET',
    });
}

function recordLabelPrint(orderId, payload) {
    if (!orderId) return Promise.reject(new Error('订单 ID 不能为空'));
    const requestId = payload && payload.clientRequestId
        ? payload.clientRequestId
        : `label-print-${orderId}-${Date.now()}`;
    return request({
        url: `${env.apiBaseUrl}/api/miniapp/staff/orders/${encodeURIComponent(String(orderId))}/label-print`,
        method: 'POST',
        data: payload || {},
        header: { 'Idempotency-Key': requestId },
    });
}

module.exports = {
    completeWash,
    getLabelPrintData,
    getStaffOrderById,
    getStaffOrders,
    recordLabelPrint,
    uploadInspectionImages,
};
