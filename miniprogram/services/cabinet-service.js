const cabinetApi = require('../api/cabinet');

// 柜机领域服务：集中维护门店与柜机展示数据及距离计算。
const STORES = [
  { id: null, name: 'GZ明祥园点', short: '明', address: '呼和浩特新城区明祥园北门丰集柜旁', available: 18, distance: '待定位' },
  { id: null, name: 'J呼市塞外康居', short: '康', address: '内蒙古自治区呼和浩特市新城区塞外康居小区', available: 9, distance: '待定位' },
  { id: null, name: 'XNG塞外安居小区点', short: '安', address: '新城区安居街道社区服务站旁', available: 6, distance: '待定位' },
];

const EARTH_RADIUS_METERS = 6371000;

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;
}

function distanceInMeters(from, to) {
  if (!from || !to || !isValidCoordinate(from.latitude, from.longitude)
    || !isValidCoordinate(to.latitude, to.longitude)) return null;
  const lat1 = Number(from.latitude) * Math.PI / 180;
  const lat2 = Number(to.latitude) * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = (Number(to.longitude) - Number(from.longitude)) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return '';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)}m`;
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function availableCountForType(store, cabinetType) {
  if (cabinetType === 'small') return Number(store.smallAvailableCount) || 0;
  if (cabinetType === 'large') return Number(store.largeAvailableCount) || 0;
  return Number(store.available) || 0;
}

function findNearestStore(userLocation, availableStores, cabinetType) {
  if (!userLocation || !Array.isArray(availableStores)) return null;
  return availableStores.reduce((nearest, store) => {
    if (availableCountForType(store, cabinetType) <= 0) return nearest;
    const serverDistance = store.distanceMeters === null || store.distanceMeters === undefined
      ? null
      : Number(store.distanceMeters);
    const distanceMeters = Number.isFinite(serverDistance)
      ? serverDistance
      : distanceInMeters(userLocation, store);
    if (distanceMeters === null) return nearest;
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      return { store: { ...store, distance: formatDistance(distanceMeters) }, distanceMeters };
    }
    return nearest;
  }, null);
}

function findNearestCabinet(userLocation, stores) {
  if (!userLocation || !Array.isArray(stores)) return null;
  return stores.reduce((nearest, store) => {
    const serverDistance = store.distanceMeters === null || store.distanceMeters === undefined
      ? null
      : Number(store.distanceMeters);
    const distanceMeters = Number.isFinite(serverDistance)
      ? serverDistance
      : distanceInMeters(userLocation, store);
    if (distanceMeters === null) return nearest;
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      return { store: { ...store, distance: formatDistance(distanceMeters) }, distanceMeters };
    }
    return nearest;
  }, null);
}

function adaptCabinet(raw) {
  const source = raw && raw.data && typeof raw.data === 'object' ? raw.data : (raw || {});
  const cabinetId = source.id ?? source.cabinetId ?? source.serviceSiteId ?? source.siteId;
  const smallAvailableCount = Number(
    source.smallAvailableCount ?? source.smallAvailable ?? source.smallCount,
  ) || 0;
  const largeAvailableCount = Number(
    source.largeAvailableCount ?? source.largeAvailable ?? source.largeCount,
  ) || 0;
  const distanceMeters = source.distanceMeters === null || source.distanceMeters === undefined
    ? null
    : Number(source.distanceMeters);
  return {
    id: cabinetId,
    name: source.cabinetName || source.name || '',
    short: (source.cabinetName || source.name) ? (source.cabinetName || source.name).charAt(0) : '柜',
    address: source.installAddress || source.address || '',
    latitude: source.latitude,
    longitude: source.longitude,
    currentOnline: source.currentOnline,
    businessStatus: source.businessStatus,
    smallAvailableCount,
    largeAvailableCount,
    available: smallAvailableCount + largeAvailableCount,
    distanceMeters,
    distance: Number.isFinite(distanceMeters) ? formatDistance(distanceMeters) : '距离未知',
  };
}

async function loadStores(location) {
  const params = location ? {
    latitude: location.latitude,
    longitude: location.longitude,
  } : {};
  const rawResult = await cabinetApi.getCabinets(params);
  const rawList = Array.isArray(rawResult)
    ? rawResult
    : (rawResult && (rawResult.records || rawResult.list || rawResult.items || rawResult.content || rawResult.data)) || [];
  return (Array.isArray(rawList) ? rawList : []).map(adaptCabinet);
}

function getStores() {
  return STORES.map((store) => ({ ...store }));
}

function getStoreNames() {
  return STORES.map((store) => store.name);
}

module.exports = {
  adaptCabinet,
  availableCountForType,
  distanceInMeters,
  findNearestStore,
  findNearestCabinet,
  formatDistance,
  getStores,
  getStoreNames,
  isValidCoordinate,
  loadStores,
};
