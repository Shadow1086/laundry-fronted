const storage = require('./storage');
const storageKey = require('../constants/storage-key');

// 会话的底层读写与首页授权入口跳转。
// 单独抽出是为了让 utils/request.js 和 services/auth-service.js 共用同一份逻辑，
// 同时避免 request → auth-service → api → request 的循环依赖。

// 未登录时统一回到首页，由首页内的手机号授权层完成登录。
const AUTH_ROUTE = 'pages/home/index';
const AUTH_URL = `/${AUTH_ROUTE}`;

// 跳转去重标记：多个请求同时收到 401 时只跳一次，避免页面抖动。
let redirecting = false;
let authPromptRequested = false;

// 跳转完成后延迟复位，覆盖同一批并发请求的回调时间差；
// 复位本身必须保留，否则跳转失败后会永久无法再跳登录页。
const REDIRECT_COOLDOWN = 500;

function clear() {
  storage.remove(storageKey.token);
  storage.remove(storageKey.user);
}

function savePendingLaunch(url) {
  if (url) storage.set(storageKey.pendingLaunch, url);
}

function consumePendingLaunch() {
  const url = storage.get(storageKey.pendingLaunch, '');
  storage.remove(storageKey.pendingLaunch);
  return url;
}

// 下单页是 tabBar 页面，跳转参数用一次性上下文传递，并跨登录保留。
function savePendingCabinetScene(value) {
  if (value) storage.set(storageKey.pendingCabinetScene, value);
}

function consumePendingCabinetScene() {
  const value = storage.get(storageKey.pendingCabinetScene, '');
  storage.remove(storageKey.pendingCabinetScene);
  return value;
}

// 登录跳转可能重建下单页，明确选择的柜机不能随一次性扫码参数一起丢失。
function saveOrderCabinetSelection(selection) {
  storage.set(storageKey.orderCabinetSelection, selection);
}

function getOrderCabinetSelection() {
  return storage.get(storageKey.orderCabinetSelection, {});
}

function clearOrderCabinetSelection() {
  storage.remove(storageKey.orderCabinetSelection);
}

function getToken() {
  return storage.get(storageKey.token, '');
}

function currentRoute() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages.length ? pages[pages.length - 1] : null;
  return current ? current.route : '';
}

function isOnAuthRoute() {
  return currentRoute() === AUTH_ROUTE;
}

// 返回值表示本次是否真的发起了跳转。
function redirectToLogin() {
  if (redirecting || isOnAuthRoute()) return false;
  authPromptRequested = true;
  redirecting = true;
  wx.reLaunch({
    url: AUTH_URL,
    complete: () => {
      setTimeout(() => {
        redirecting = false;
      }, REDIRECT_COOLDOWN);
    },
  });
  return true;
}

function consumeAuthPrompt() {
  const requested = authPromptRequested;
  authPromptRequested = false;
  return requested;
}

module.exports = {
  AUTH_ROUTE,
  AUTH_URL,
  clear,
  consumeAuthPrompt,
  currentRoute,
  getToken,
  isOnAuthRoute,
  redirectToLogin,
  savePendingLaunch,
  consumePendingLaunch,
  savePendingCabinetScene,
  consumePendingCabinetScene,
  saveOrderCabinetSelection,
  getOrderCabinetSelection,
  clearOrderCabinetSelection,
};
