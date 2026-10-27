function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: (location) => resolve({
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      }),
      fail: reject,
    });
  });
}

const MAX_CABINET_DISTANCE_METERS = 300;

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;
}

function distanceInMeters(from, to) {
  if (!from || !to || !isValidCoordinate(from.latitude, from.longitude)
    || !isValidCoordinate(to.latitude, to.longitude)) return null;
  const radians = Math.PI / 180;
  const lat1 = Number(from.latitude) * radians;
  const lat2 = Number(to.latitude) * radians;
  const deltaLat = lat2 - lat1;
  const deltaLon = (Number(to.longitude) - Number(from.longitude)) * radians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkDistance(userLocation, cabinetLocation, maxDistanceMeters = MAX_CABINET_DISTANCE_METERS) {
  const distanceMeters = distanceInMeters(userLocation, cabinetLocation);
  return {
    allowed: distanceMeters !== null && distanceMeters <= maxDistanceMeters,
    distanceMeters,
    maxDistanceMeters,
    reason: distanceMeters === null ? 'location-unavailable' : distanceMeters > maxDistanceMeters ? 'too-far' : '',
  };
}

async function checkCurrentDistance(cabinetLocation, maxDistanceMeters = MAX_CABINET_DISTANCE_METERS) {
  const userLocation = await getCurrentLocation();
  return { userLocation, ...checkDistance(userLocation, cabinetLocation, maxDistanceMeters) };
}

module.exports = {
  MAX_CABINET_DISTANCE_METERS,
  checkCurrentDistance,
  checkDistance,
  distanceInMeters,
  getCurrentLocation,
  isValidCoordinate,
};
