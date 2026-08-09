const authApi = require('../api/auth');
const storage = require('../utils/storage');
const storageKey = require('../constants/storage-key');

function saveSession(session) {
  const normalized = normalizeSession(session);
  storage.set(storageKey.token, normalized.token || '');
  if (normalized.user) storage.set(storageKey.user, normalized.user);
  return normalized;
}

function getCurrentUser() {
  return storage.get(storageKey.user, null);
}

function getToken() {
  return storage.get(storageKey.token, '');
}

function isAuthenticated() {
  return Boolean(getToken());
}

function normalizeSession(payload) {
  const body = payload && payload.data && !payload.token ? payload.data : payload;
  if (!body || !body.token) {
    const error = new Error((body && (body.message || body.msg)) || '登录接口未返回有效令牌');
    error.code = 'INVALID_SESSION';
    throw error;
  }
  return { token: body.token, user: body.user || null };
}

function maskTelephone(telephone) {
  if (!telephone) return '未绑定手机号';
  const value = String(telephone);
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function redirectToLogin() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages.length ? pages[pages.length - 1] : null;
  if (current && current.route === 'pages/login/login') return false;
  wx.reLaunch({ url: '/pages/login/login' });
  return true;
}

function requireLogin() {
  if (isAuthenticated()) return true;
  redirectToLogin();
  return false;
}

async function login(payload) {
  const session = await authApi.login(payload);
  return saveSession(session);
}

function saveDemoSession() {
  return saveSession({
    token: 'demo-token',
    user: {
      id: 'demo-user',
      username: '易净体验官',
      telephone: '13800138000',
      avatarUrl: '',
      isManager: 0,
    },
  });
}

function clearSession() {
  storage.remove(storageKey.token);
  storage.remove(storageKey.user);
}

module.exports = {
  clearSession,
  getCurrentUser,
  getToken,
  isAuthenticated,
  login,
  maskTelephone,
  normalizeSession,
  redirectToLogin,
  requireLogin,
  saveDemoSession,
  saveSession,
};
