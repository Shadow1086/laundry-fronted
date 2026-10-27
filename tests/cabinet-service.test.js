const assert = require('node:assert/strict');
const test = require('node:test');

const cabinetService = require('../miniprogram/services/cabinet-service');

test('distanceInMeters returns zero for the same location', () => {
  const location = { latitude: 40.8421, longitude: 111.7317 };
  assert.equal(cabinetService.distanceInMeters(location, location), 0);
});

test('findNearestStore selects the nearest available store', () => {
  const stores = [
    { name: '远柜机', latitude: 40.85, longitude: 111.74, available: 10 },
    { name: '近柜机', latitude: 40.8422, longitude: 111.7318, available: 2 },
  ];
  const nearest = cabinetService.findNearestStore(
    { latitude: 40.8421, longitude: 111.7317 },
    stores,
  );

  assert.equal(nearest.store.name, '近柜机');
  assert.match(nearest.store.distance, /^\d+m$/);
});

test('findNearestStore ignores unavailable stores and invalid coordinates', () => {
  const stores = [
    { name: '无空柜', latitude: 40.8421, longitude: 111.7317, available: 0 },
    { name: '无坐标', available: 5 },
    { name: '可用柜机', latitude: 40.85, longitude: 111.74, available: 1 },
  ];
  const nearest = cabinetService.findNearestStore(
    { latitude: 40.8421, longitude: 111.7317 },
    stores,
  );

  assert.equal(nearest.store.name, '可用柜机');
});

test('findNearestStore returns null when no store can be located', () => {
  const nearest = cabinetService.findNearestStore(
    { latitude: 40.8421, longitude: 111.7317 },
    [{ name: '无坐标', available: 5 }],
  );

  assert.equal(nearest, null);
});

test('findNearestStore prefers the server-provided distance', () => {
  const nearest = cabinetService.findNearestStore(
    { latitude: 40.8421, longitude: 111.7317 },
    [
      { name: '服务端近柜机', latitude: 40.9, longitude: 111.9, distanceMeters: 10, available: 1 },
      { name: '本地近柜机', latitude: 40.8422, longitude: 111.7318, available: 1 },
    ],
  );

  assert.equal(nearest.store.name, '服务端近柜机');
  assert.equal(nearest.distanceMeters, 10);
});

test('findNearestStore only considers cabinets with the requested size', () => {
  const nearest = cabinetService.findNearestStore(
    { latitude: 40.8421, longitude: 111.7317 },
    [
      { name: '仅大柜', latitude: 40.8422, longitude: 111.7318, smallAvailableCount: 0, largeAvailableCount: 2 },
      { name: '有小柜', latitude: 40.85, longitude: 111.74, smallAvailableCount: 1, largeAvailableCount: 0 },
    ],
    'small',
  );

  assert.equal(nearest.store.name, '有小柜');
});

test('findNearestCabinet includes cabinets regardless of available cabinet size', () => {
  const nearest = cabinetService.findNearestCabinet(
    { latitude: 40.8421, longitude: 111.7317 },
    [
      { name: '仅大柜', latitude: 40.8422, longitude: 111.7318, smallAvailableCount: 0, largeAvailableCount: 1 },
      { name: '较远柜机', latitude: 40.85, longitude: 111.74, smallAvailableCount: 2, largeAvailableCount: 0 },
    ],
  );

  assert.equal(nearest.store.name, '仅大柜');
});
