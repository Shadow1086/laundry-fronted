// 柜机领域服务：集中维护门店与柜机展示数据。
const STORES = [
  { name: 'GZ明祥园点', short: '明', address: '呼和浩特新城区明祥园北门丰集柜旁', available: 18, distance: '307.6km' },
  { name: 'J呼市塞外康居', short: '康', address: '内蒙古自治区呼和浩特市新城区塞外康居小区', available: 9, distance: '308.3km' },
  { name: 'XNG塞外安居小区点', short: '安', address: '新城区安居街道社区服务站旁', available: 6, distance: '309.1km' },
];

function getStores() {
  return STORES.map((store) => ({ ...store }));
}

function getStoreNames() {
  return STORES.map((store) => store.name);
}

module.exports = { getStores, getStoreNames };
