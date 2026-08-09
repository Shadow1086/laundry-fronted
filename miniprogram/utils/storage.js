function get(key, fallback) {
  const value = wx.getStorageSync(key);
  return value === '' || value === undefined || value === null ? fallback : value;
}

function set(key, value) {
  wx.setStorageSync(key, value);
}

function remove(key) {
  wx.removeStorageSync(key);
}

module.exports = { get, remove, set };
