const authApi = require('../api/auth');
const userApi = require('../api/user');
const session = require('../utils/session');
const storage = require('../utils/storage');
const storageKey = require('../constants/storage-key');
const { ACCOUNT_TYPE_ROLE, ADMIN_ROLES, ROLE, ROLE_GRANTS } = require('../constants/role');

// 无权访问时提示语的停留时间，到点再跳走，避免 toast 被新页面立刻覆盖。
const DENY_TOAST_DURATION = 1500;

function saveSession(payload) {
  const normalized = normalizeSession(payload);
  storage.set(storageKey.token, normalized.token || '');
  if (normalized.user) storage.set(storageKey.user, normalized.user);
  return normalized;
}

function getCurrentUser() {
  return storage.get(storageKey.user, null);
}

function getToken() {
  return session.getToken();
}

function isAuthenticated() {
  return Boolean(getToken());
}

// request.js 已经解包过 { code, message, data }，这里拿到的就是登录业务数据本身。
function normalizeSession(payload) {
  const body = payload || {};
  if (!body.token) {
    const error = new Error(body.message || body.msg || '登录接口未返回有效令牌');
    error.code = 'INVALID_SESSION';
    throw error;
  }
  const user = normalizeUser(body.user || body.userInfo || body.profile || body);
  return { token: body.token, user };
}

function normalizeUser(source) {
  const value = source || {};
  return {
    ...value,
    id: value.id || '',
    username: value.username || value.nickname || value.name || '',
    telephone: value.telephone || value.mobile || value.phone || value.phoneMasked || value.phoneNumber || value.purePhoneNumber || value.phone_masked || '',
    avatarUrl: value.avatarUrl || value.avatar || '',
    accountType: value.accountType || value.role || 'CUSTOMER',
  };
}

function maskTelephone(telephone) {
  if (!telephone) return '未绑定手机号';
  const value = String(telephone);
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function redirectToLogin() {
  return session.redirectToLogin();
}

function requireLogin() {
  if (isAuthenticated()) return true;
  redirectToLogin();
  return false;
}

// 返回 'admin' | 'manager' | 'staff' | 'user'
// SUPER_ADMIN / PLATFORM_OWNER 统一归为 'admin'，其权限覆盖 manager 与 staff。
function getRole() {
  const user = getCurrentUser();
  const accountType = user ? user.accountType : '';
  return ACCOUNT_TYPE_ROLE[accountType] || ROLE.USER;
}

// 按 ROLE_GRANTS 判断当前账号是否具备目标角色的访问权限（含上级角色覆盖下级）。
function hasRole(expectedRole) {
  const grants = ROLE_GRANTS[getRole()] || [];
  return grants.indexOf(expectedRole) !== -1;
}

function canAccessAdmin() {
  return ADMIN_ROLES.indexOf(getRole()) !== -1;
}

// 统一的拒绝访问处理：提示后回到首页，返回 false 供调用方直接 return。
function denyAccess(message) {
  wx.showToast({ title: message || '当前账号无权访问', icon: 'none', duration: DENY_TOAST_DURATION });
  setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), DENY_TOAST_DURATION);
  return false;
}

function requireRole(expectedRole) {
  if (!requireLogin()) return false;
  if (hasRole(expectedRole)) return true;
  return denyAccess();
}

function requireAdmin() {
  if (!requireLogin()) return false;
  if (canAccessAdmin()) return true;
  return denyAccess('当前账号无管理权限');
}

// 登录成功后拉取完整用户资料（昵称、手机号），失败不影响主流程。
async function fetchAndSaveProfile() {
  try {
    const response = await userApi.getMe();
    const profile = response && (response.user || response.userInfo || response.profile || response.data) || response || {};
    const existing = getCurrentUser() || {};
    const normalized = normalizeUser(profile);
    const enriched = {
      ...existing,
      ...normalized,
      username: normalized.username || existing.username,
      telephone: normalized.telephone || existing.telephone,
      avatarUrl: normalized.avatarUrl || existing.avatarUrl,
      isMember: profile.isMember !== undefined ? Boolean(profile.isMember) : Boolean(existing.isMember),
      membershipExpiresAt: Object.prototype.hasOwnProperty.call(profile, 'membershipExpiresAt')
        ? profile.membershipExpiresAt
        : (existing.membershipExpiresAt || null),
      registrationSource: profile.registrationSource || existing.registrationSource,
      // 后端 /user/me 目前不返回 accountType；一旦补上就能在此刷新角色，
      // 否则角色只能停留在登录那一刻的取值，后台改权限需重新登录才生效。
      accountType: profile.accountType || existing.accountType,
    };
    storage.set(storageKey.user, enriched);
    return enriched;
  } catch (e) {
    return getCurrentUser();
  }
}

async function updateProfile(payload) {
  const current = getCurrentUser() || {};
  const response = await userApi.updateMe({
    username: payload.username,
    mobile: payload.mobile,
  });
  const profile = response && (response.user || response.userInfo || response.profile || response.data) || response || {};
  const normalized = normalizeUser(profile);
  const updated = {
    ...current,
    ...normalized,
    username: normalized.username || payload.username || current.username,
    telephone: normalized.telephone || payload.mobile || current.telephone,
  };
  storage.set(storageKey.user, updated);
  return updated;
}

async function login(payload) {
  const session = await authApi.login(payload);
  saveSession(session);
  return { token: getToken(), user: await fetchAndSaveProfile() };
}

function clearSession() {
  session.clear();
}

module.exports = {
  canAccessAdmin,
  clearSession,
  fetchAndSaveProfile,
  getCurrentUser,
  getRole,
  getToken,
  hasRole,
  isAuthenticated,
  login,
  maskTelephone,
  normalizeSession,
  normalizeUser,
  redirectToLogin,
  requireAdmin,
  requireLogin,
  requireRole,
  saveSession,
  updateProfile,
};
