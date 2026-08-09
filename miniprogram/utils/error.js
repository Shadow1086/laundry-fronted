function getMessage(error, fallback = '操作失败，请稍后重试') {
  return error && error.message ? error.message : fallback;
}

module.exports = { getMessage };
