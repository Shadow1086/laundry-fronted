const session = require('./session');

// 网络请求统一入口，集中处理令牌、响应包装和 HTTP 错误。
// 后端统一返回 { code, message, data }，成功业务码为 0；
// 401 HTTP 状态表示令牌失效，自动清除会话并跳转登录。
function handleResponse(resolve, reject, body, statusCode, failLabel) {
  // 令牌失效或未登录：清除本地会话并跳转登录页（并发 401 只跳一次）。
  if (statusCode === 401) {
    session.clear();
    session.redirectToLogin();
    reject(new Error(body.message || '登录已过期，请重新登录'));
    return;
  }
  if (statusCode < 200 || statusCode >= 300) {
    reject(new Error(body.message || `${failLabel}（${statusCode}）`));
    return;
  }
  // 后端业务码：0 为成功，非 0 为业务失败。
  if (body.success === false || (body.code !== undefined && body.code !== 0 && body.code !== 200)) {
    const error = new Error(body.message || '请求未成功');
    error.result = body.data;
    error.code = body.code;
    reject(error);
    return;
  }
  // 自动解包 data 字段，调用方直接获得业务数据。
  resolve(body.data !== undefined ? body.data : body);
}

function authHeader(options) {
  const header = { ...(options.header || {}) };
  const token = session.getToken();
  if (token) header.Authorization = `Bearer ${token}`;
  return header;
}

// wx.request 会将 GET 数组编码成 JSON 文本，枚举列表需要使用重复查询参数。
function normalizeGetArrayParams(options) {
    if (String(options.method || 'GET').toUpperCase() !== 'GET'
        || !options.data || typeof options.data !== 'object' || Array.isArray(options.data)) {
        return options;
    }
    const data = { ...options.data };
    const query = [];
    Object.keys(data).forEach((key) => {
        const values = data[key];
        if (!Array.isArray(values)) return;
        values.forEach((value) => {
            if (value !== undefined && value !== null) {
                query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
            }
        });
        delete data[key];
    });
    const separator = options.url.includes('?') ? '&' : '?';
    return {
        ...options,
        url: query.length ? `${options.url}${separator}${query.join('&')}` : options.url,
        data,
    };
}

function request(options) {
    const requestOptions = normalizeGetArrayParams(options);
  return new Promise((resolve, reject) => {
    wx.request({
      ...requestOptions,
      header: authHeader(requestOptions),
      success: (response) => {
        handleResponse(resolve, reject, response.data || {}, response.statusCode, '请求失败');
      },
      fail: reject,
    });
  });
}

function uploadFile(options) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      ...options,
      header: authHeader(options),
      success: (response) => {
        let body = {};
        try {
          body = JSON.parse(response.data) || {};
        } catch (error) {
          body = {};
        }
        handleResponse(resolve, reject, body, response.statusCode, '上传失败');
      },
      fail: reject,
    });
  });
}

// wx.uploadFile 单次只能携带一个文件，多文件单请求需要手工拼 multipart 报文。
// 小程序环境没有 TextEncoder/FormData，UTF-8 编码与拼接需自行实现。
function utf8Encode(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    // 组合 UTF-16 代理对，得到完整码点。
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((item) => {
    result.set(item, offset);
    offset += item.length;
  });
  return result;
}

// 临时文件路径形如 wxfile://tmp_xxx.jpg，仅取文件名；无后缀时按序号兜底。
function extractFileName(filePath, index, fallbackPrefix) {
  const raw = String(filePath || '').split('/').pop() || '';
  if (/\.(jpe?g|png|webp)$/i.test(raw)) return raw;
  return `${fallbackPrefix || 'file'}-${index + 1}.jpg`;
}

function guessContentType(fileName) {
  if (/\.png$/i.test(fileName)) return 'image/png';
  if (/\.webp$/i.test(fileName)) return 'image/webp';
  return 'image/jpeg';
}

// 压缩图片失败时回退原文件，避免因为系统压缩能力异常导致整批上传失败。
function compressImage(filePath, quality) {
  return new Promise((resolve) => {
    if (!filePath || typeof wx.compressImage !== 'function') {
      resolve(filePath);
      return;
    }
    wx.compressImage({
      src: filePath,
      quality: quality === undefined ? 75 : quality,
      success: (result) => resolve(result.tempFilePath || filePath),
      fail: () => resolve(filePath),
    });
  });
}

// 多文件单请求上传：读取全部文件后手工拼 multipart，通过 wx.request 发送。
// options: { url, filePaths, name, formData, header, timeout, compress, compressQuality }
function uploadFiles(options) {
  const filePaths = options.filePaths || [];
  if (!filePaths.length && !options.allowEmpty) {
    return Promise.reject(new Error('未选择要上传的文件'));
  }
  const fs = wx.getFileSystemManager();
  const readFile = (filePath) => new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(error.errMsg || '读取文件失败')),
    });
  });
  const preparedFilePaths = options.compress
    ? Promise.all(filePaths.map((filePath) => compressImage(filePath, options.compressQuality)))
    : Promise.resolve(filePaths);
  return preparedFilePaths.then((paths) => Promise.all(paths.map(readFile)).then((buffers) => {
    const boundary = `lklaundry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const parts = [];
    Object.keys(options.formData || {}).forEach((key) => {
      parts.push(utf8Encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${String(options.formData[key])}\r\n`,
      ));
    });
    buffers.forEach((buffer, index) => {
      const fileName = extractFileName(paths[index], index, 'inspection');
      parts.push(utf8Encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${options.name || 'files'}"; filename="${fileName}"\r\n` +
        `Content-Type: ${guessContentType(fileName)}\r\n\r\n`,
      ));
      parts.push(new Uint8Array(buffer));
      parts.push(utf8Encode('\r\n'));
    });
    parts.push(utf8Encode(`--${boundary}--\r\n`));
    const body = concatUint8Arrays(parts);
    return new Promise((resolve, reject) => {
      wx.request({
        url: options.url,
        method: 'POST',
        data: body.buffer,
        timeout: options.timeout,
        header: {
          ...authHeader(options),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        success: (response) => {
          handleResponse(resolve, reject, response.data || {}, response.statusCode, '上传失败');
        },
        fail: reject,
      });
    });
  }));
}

module.exports = { request, uploadFile, uploadFiles };
