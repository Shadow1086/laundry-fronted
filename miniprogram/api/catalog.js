const { request } = require('../utils/request');
const env = require('../config/env');

function getCategories() {
  const url = `${env.apiBaseUrl}/api/miniapp/catalog/categories`;
  console.info('[catalog-api] GET', url);
  return request({ url, method: 'GET' });
}

module.exports = { getCategories };
