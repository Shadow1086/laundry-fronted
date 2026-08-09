const storage = require('./storage');
const storageKey = require('../constants/storage-key');

// 网络请求统一入口，集中处理令牌、响应包装和 HTTP 错误。
function request(options) {
  return new Promise((resolve, reject) => {
    const token = storage.get(storageKey.token, '');
    const header = { ...(options.header || {}) };
    if (token) header.Authorization = `Bearer ${token}`;
    wx.request({
      ...options,
      header,
      success: (response) => {
        const body = response.data || {};
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(body.message || body.msg || `请求失败（${response.statusCode}）`));
          return;
        }
        if (body.success === false || (body.code !== undefined && body.code !== 0 && body.code !== 200)) {
          reject(new Error(body.message || body.msg || '请求未成功'));
          return;
        }
        resolve(body);
      },
      fail: reject,
    });
  });
}

module.exports = { request };
