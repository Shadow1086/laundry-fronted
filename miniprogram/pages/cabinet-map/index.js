const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');
const serviceSiteApi = require('../../api/service-site');
const locationService = require('../../services/location-service');
const bmap = require('../../libs/bmap-wx');
const baiduMapConfig = require('../../config/baidu-map');

const DEFAULT_CENTER = { latitude: 40.8426, longitude: 111.7492 };

Page({
  data: {
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    scale: 13,
    markers: [],
    stores: [],
    processingSites: [],
    selectedStore: null,
    selectedSite: null,
    currentAddress: '',
    loading: true,
    message: '',
  },

  onLoad() {
    if (!authService.requireLogin()) return;
    this.baiduMap = baiduMapConfig.ak ? new bmap.BMapWX({ ak: baiduMapConfig.ak }) : null;
    this.loadMapData();
  },

  geocodeAddress(address) {
    if (!this.baiduMap || !address) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.baiduMap.geocoding({
        address,
        city: '呼和浩特市',
        coordtype: 'gcj02ll',
        success: (result) => {
          const marker = result && result.wxMarkerData && result.wxMarkerData[0];
          if (!marker || !cabinetService.isValidCoordinate(marker.latitude, marker.longitude)) {
            resolve(null);
            return;
          }
          resolve({ latitude: Number(marker.latitude), longitude: Number(marker.longitude) });
        },
        fail: () => resolve(null),
      });
    });
  },

  async fillMissingCoordinates(stores) {
    if (!this.baiduMap) return stores;
    const missing = stores.filter((store) => !cabinetService.isValidCoordinate(store.latitude, store.longitude) && store.address);
    if (!missing.length) return stores;
    // 百度地址解析只补全缺少坐标的柜机，已有后端坐标始终优先。
    const resolved = await Promise.all(missing.map((store) => this.geocodeAddress(store.address)));
    const coordinates = new Map(missing.map((store, index) => [store.id, resolved[index]]));
    return stores.map((store) => {
      const coordinate = coordinates.get(store.id);
      return coordinate ? { ...store, ...coordinate, coordinateSource: 'baidu' } : store;
    });
  },

  reverseGeocode(location) {
    if (!this.baiduMap || !location) return Promise.resolve('');
    return new Promise((resolve) => {
      this.baiduMap.regeocoding({
        location: `${location.latitude},${location.longitude}`,
        coordtype: 'gcj02ll',
        extensions_poi: 0,
        success: (result) => {
          const marker = result && result.wxMarkerData && result.wxMarkerData[0];
          resolve(marker && marker.address ? marker.address : '');
        },
        fail: () => resolve(''),
      });
    });
  },

  async loadMapData() {
    this.setData({ loading: true, message: '', currentAddress: '', selectedStore: null, selectedSite: null });
    let userLocation = null;
    try {
      userLocation = await locationService.getCurrentLocation();
    } catch (error) {
      this.setData({ message: '无法获取当前位置，已显示柜机全量分布' });
    }
    try {
      const [rawStores, rawSites] = await Promise.all([
        cabinetService.loadStores(userLocation),
        serviceSiteApi.getServiceSites().catch(() => []),
      ]);
      const stores = await this.fillMissingCoordinates(rawStores);
      const siteList = Array.isArray(rawSites)
        ? rawSites
        : (rawSites && (rawSites.records || rawSites.list || rawSites.items || rawSites.data)) || [];
      const processingSitesWithCoordinates = await this.fillMissingCoordinates(siteList);
      const processingSites = processingSitesWithCoordinates.filter((site) => cabinetService.isValidCoordinate(site.latitude, site.longitude));
      const validStores = stores.filter((store) => cabinetService.isValidCoordinate(store.latitude, store.longitude));
      if (!validStores.length && !processingSites.length) {
        this.setData({
          stores: [],
          processingSites: [],
          markers: [],
          loading: false,
          message: this.baiduMap
            ? '后端暂未返回有效坐标，且地址解析失败'
            : '后端暂未返回带坐标的柜机，请先配置百度地图 AK',
        });
        return;
      }
      const center = userLocation || validStores[0] || processingSites[0];
      const currentAddress = await this.reverseGeocode(userLocation);
      const cabinetMarkers = validStores.map((store, index) => ({
        id: index,
        latitude: Number(store.latitude),
        longitude: Number(store.longitude),
        iconPath: '/assets/tabbar/order-active.png',
        width: 34,
        height: 42,
        callout: { content: store.name || '智能柜', display: 'ALWAYS', padding: 6, borderRadius: 4 },
      }));
      const siteMarkers = processingSites.map((site, index) => ({
        id: validStores.length + index,
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
        iconPath: '/assets/icons/map-pin.svg',
        width: 34,
        height: 42,
        callout: { content: site.siteName || '处理点', display: 'ALWAYS', padding: 6, borderRadius: 4 },
      }));
      this.setData({
        latitude: center.latitude,
        longitude: center.longitude,
        stores: validStores,
        processingSites,
        currentAddress,
        markers: cabinetMarkers.concat(siteMarkers),
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, message: '柜机数据加载失败，请稍后重试' });
    }
  },

  onMarkerTap(e) {
    const markerId = e && e.detail && e.detail.markerId !== undefined ? e.detail.markerId : e && e.markerId;
    const index = Number(markerId);
    if (!Number.isFinite(index)) return;
    if (index < this.data.stores.length) {
      const store = this.data.stores[index];
      if (store) this.setData({ selectedStore: store, selectedSite: null });
      return;
    }
    const site = this.data.processingSites[index - this.data.stores.length];
    if (site) this.setData({ selectedSite: site, selectedStore: null });
  },

  closeStore() { this.setData({ selectedStore: null, selectedSite: null }); },
  locateMe() {
    wx.createMapContext('cabinet-map').moveToLocation();
  },
  retry() { this.loadMapData(); },
});
