function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatDistance(value) {
  return value ? String(value) : '--';
}

module.exports = { formatDistance, formatMoney };
