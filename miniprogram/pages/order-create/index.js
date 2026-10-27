const authService = require('../../services/auth-service');
const cabinetService = require('../../services/cabinet-service');
const orderApi = require('../../api/order');
const orderService = require('../../services/order-service');
const locationService = require('../../services/location-service');
const scanContext = require('../../utils/scan-context');
const serviceConfigApi = require('../../api/service-config');
const cabinetApi = require('../../api/cabinet');
const session = require('../../utils/session');

Page({
  data: {
    clothingGroups: [],
    activeGroupKey: '',
    activeGroup: null,
    selectedItems: [],
    selectedCount: 0,
    estimate: '0.00',
    scrollIntoView: '',
    stores: [],
    selectedStore: '',
    selectedStoreInfo: {},
    cabinetType: 'small',
    showSelection: false,
    confirmMode: false,
    inlineMessage: '',
    locationStatus: 'idle',
    locationMessage: '',
    catalogLoading: false,
    businessStatus: null,
    currentLocation: null,
    memberPriceApplied: false,
    authVisible: false,
  },

  onLoad(options = {}) {
    this._selectionVersion = 0;
    const context = scanContext.parse(options);
    const pendingScene = session.consumePendingCabinetScene();
    const selection = context.type === 'cabinet' || context.type === 'cabinet-scene'
      ? context
      : pendingScene ? { type: 'cabinet-scene', value: pendingScene }
        : session.getOrderCabinetSelection();
    this._restoredCabinetSelection = !context.type && !pendingScene && Boolean(selection.value);
    this._presetCabinetId = selection.type === 'cabinet' ? selection.value : '';
    this._cabinetScanSceneKey = selection.type === 'cabinet-scene' ? selection.value : '';
    this._presetCabinetName = selection.name || '';
    if (selection.value) session.saveOrderCabinetSelection(selection);
    if (this._cabinetScanSceneKey) this._presetCabinetPromise = this._loadPresetCabinet(this._cabinetScanSceneKey);
    this.loadBusinessStatus();
  },

  async _loadPresetCabinet(scanSceneKey) {
    const selectionVersion = this._selectionVersion;
    try {
      const cabinet = await cabinetApi.getCabinetByScanScene(scanSceneKey);
      if (selectionVersion !== this._selectionVersion) return;
      if (!cabinet || cabinet.id === undefined || cabinet.id === null) throw new Error('柜机不存在');
      this._presetCabinetId = String(cabinet.id);
      this._presetCabinetName = cabinet.name || cabinet.cabinetName || '';
      this._presetCabinet = cabinet;
      const preset = cabinetService.adaptCabinet(cabinet);
      this.setData({ selectedStore: preset.name, selectedStoreInfo: preset });
    } catch (error) {
      if (selectionVersion !== this._selectionVersion) return;
      this._cabinetScanError = error.message || '柜机二维码无效，请重新扫码';
      this.setData({ selectedStore: '', selectedStoreInfo: {}, inlineMessage: this._cabinetScanError });
      wx.showToast({ title: this._cabinetScanError, icon: 'none' });
    }
  },

  async onShow() {
    const scene = session.consumePendingCabinetScene();
    if (scene) {
      session.saveOrderCabinetSelection({ type: 'cabinet-scene', value: scene });
      this._selectionVersion += 1;
      this._presetCabinetId = '';
      this._presetCabinet = null;
      this._cabinetScanError = '';
      this._cabinetScanSceneKey = scene;
      this.setData({ selectedStore: '', selectedStoreInfo: {}, inlineMessage: '' });
      this._presetCabinetPromise = this._loadPresetCabinet(scene);
    }
    // 从确认页返回后允许再次提交。
    this._navigatingToConfirm = false;
    await Promise.all([this.refreshCatalog(), this.initializeStores()]);
    if (this._restoredCabinetSelection && authService.isAuthenticated()) {
      session.clearOrderCabinetSelection();
      this._restoredCabinetSelection = false;
    }
  },

  async loadBusinessStatus() {
    try {
      const result = await serviceConfigApi.getBusinessStatus();
      const businessStatus = Number(result && typeof result === 'object'
        ? (result.businessStatus ?? result.status)
        : result);
      this.setData({ businessStatus: businessStatus === 0 ? 0 : 1 });
    } catch (error) {
      this.setData({ businessStatus: null });
    }
  },

  async initializeStores() {
    if (this._storesLoading) return;
    this._storesLoading = true;
    const selectionVersion = this._selectionVersion;
    await this._presetCabinetPromise;
    this.setData({ locationStatus: 'locating', locationMessage: '正在为你推荐附近柜机' });
    try {
      const location = this.data.currentLocation || (authService.isAuthenticated() ? await locationService.getCurrentLocation() : null);
      const nearbyStores = await cabinetService.loadStores(location);
      this._includePresetCabinet(nearbyStores);
      const presetStore = this._findPresetStore(nearbyStores);
      const nearestAvailable = cabinetService.findNearestStore(location, nearbyStores);
      const nearestCabinet = cabinetService.findNearestCabinet(location, nearbyStores);
      const currentStore = nearbyStores.find((store) => (
        this.data.selectedStoreInfo.id !== null
        && this.data.selectedStoreInfo.id !== undefined
        && String(store.id) === String(this.data.selectedStoreInfo.id)
      ));
      const recommended = (nearestAvailable && nearestAvailable.store)
        || (nearestCabinet && nearestCabinet.store) || nearbyStores[0];
      const selectedStore = this._cabinetScanError ? null
        : presetStore || currentStore || (this._presetCabinetId ? null : recommended);
      if (selectionVersion !== this._selectionVersion) return;
      const cabinetType = this._cabinetTypeForStore(selectedStore, this.data.cabinetType);
      const scannedCabinetFullMessage = this._scannedCabinetFullMessage(selectedStore);
      this.setData({
        stores: nearbyStores,
        selectedStore: selectedStore ? selectedStore.name : '',
        selectedStoreInfo: selectedStore || {},
        cabinetType,
        inlineMessage: this._cabinetScanError || scannedCabinetFullMessage
          || (this._presetCabinetId && !selectedStore ? '扫码柜机暂不可用，请重新扫码或手动选择柜机' : this.data.inlineMessage),
        currentLocation: location,
        locationStatus: selectedStore ? 'success' : 'failed',
        locationMessage: this._cabinetScanError || (selectedStore
          ? this._formatDistanceMessage(locationService.distanceInMeters(location, selectedStore))
          : '暂无可用柜机，请手动选择'),
      });
    } catch (error) {
      console.warn('[order-create] location unavailable', error);
      try {
        const availableStores = await cabinetService.loadStores().catch((loadError) => {
          if (this._presetCabinet) return [];
          throw loadError;
        });
        this._includePresetCabinet(availableStores);
        const presetStore = this._findPresetStore(availableStores);
        if (selectionVersion !== this._selectionVersion) return;
        const currentStore = availableStores.find((store) => (
          this.data.selectedStoreInfo.id !== null
          && this.data.selectedStoreInfo.id !== undefined
          && String(store.id) === String(this.data.selectedStoreInfo.id)
        ));
        const selectableStore = this._cabinetScanError ? null : presetStore || currentStore
          || (this._presetCabinetId ? null : (availableStores.find((store) => store.available > 0)
          || availableStores[0]));
        if (selectableStore) {
          const cabinetType = this._cabinetTypeForStore(selectableStore, this.data.cabinetType);
          const scannedCabinetFullMessage = this._scannedCabinetFullMessage(selectableStore);
          this.setData({
            stores: availableStores,
            selectedStore: selectableStore.name,
            selectedStoreInfo: selectableStore,
            cabinetType,
            locationStatus: 'failed',
            locationMessage: '定位不可用，请手动确认投放柜机',
            inlineMessage: this._cabinetScanError || scannedCabinetFullMessage || this.data.inlineMessage,
          });
          return;
        }
        this.setData({
          stores: availableStores,
          selectedStore: '',
          selectedStoreInfo: {},
          locationStatus: 'failed',
          locationMessage: this._cabinetScanError || '扫码柜机暂不可用，请手动选择柜机',
          inlineMessage: this._cabinetScanError || this.data.inlineMessage,
        });
        return;
      } catch (loadError) {
        console.warn('[order-create] cabinet list unavailable', loadError);
      }
      if (selectionVersion === this._selectionVersion) {
        this.setData({
          stores: [],
          selectedStore: '',
          selectedStoreInfo: {},
          locationStatus: 'failed',
          locationMessage: '附近柜机推荐暂不可用，请稍后重试',
        });
      }
    } finally {
      this._storesLoading = false;
      if (selectionVersion !== this._selectionVersion) this.initializeStores();
    }
  },

  _includePresetCabinet(stores) {
    if (!this._presetCabinet) return;
    const preset = cabinetService.adaptCabinet(this._presetCabinet);
    if (!stores.some((store) => String(store.id) === String(preset.id))) stores.unshift(preset);
  },

  _findPresetStore(stores) {
    if (!this._presetCabinetId || !Array.isArray(stores)) return null;
    const target = String(this._presetCabinetId);
    return stores.find((store) => String(store.id) === target) || null;
  },

  _formatDistanceMessage(distanceMeters) {
    if (distanceMeters === null || distanceMeters === undefined || !Number.isFinite(Number(distanceMeters))) {
      return '距离暂不可用';
    }
    return `距离柜机约 ${Math.round(Number(distanceMeters))} 米`;
  },

  _cabinetTypeForStore(store, currentType) {
    if (!store) return currentType || 'small';
    if (cabinetService.availableCountForType(store, currentType) > 0) return currentType;
    const otherType = currentType === 'small' ? 'large' : 'small';
    return cabinetService.availableCountForType(store, otherType) > 0 ? otherType : currentType;
  },

  _isCabinetFull(store) {
    if (!store) return false;
    return cabinetService.availableCountForType(store, 'small') <= 0
      && cabinetService.availableCountForType(store, 'large') <= 0;
  },

  _scannedCabinetFullMessage(store) {
    return this._presetCabinetId && this._isCabinetFull(store)
      ? '当前选择的柜机没有可用格口，请稍后重试或选择其他柜机'
      : '';
  },

  async refreshSelectedStoreDistance(store) {
    if (!store) return null;
    this.setData({ locationStatus: 'locating', locationMessage: '正在重新计算与柜机的距离' });
    try {
      const locationCheck = await locationService.checkCurrentDistance(store);
      this.setData({
        currentLocation: locationCheck.userLocation,
        locationStatus: locationCheck.allowed ? 'success' : 'failed',
        locationMessage: locationCheck.distanceMeters === null
          ? '距离暂不可用'
          : `${this._formatDistanceMessage(locationCheck.distanceMeters)}${locationCheck.allowed ? '' : '，超出 300 米'}`,
      });
      return locationCheck;
    } catch (error) {
      this.setData({ locationStatus: 'failed', locationMessage: '定位失败，请重试' });
      return null;
    }
  },

  async refreshCatalog() {
    if (this.data.catalogLoading) return;
    this.setData({ catalogLoading: true, inlineMessage: this._cabinetScanError || '' });
    try {
      console.info('[order-create] loading clothing catalog');
      const groups = await orderService.loadClothingGroups();
      const previousCounts = new Map();
      this.data.clothingGroups.forEach((group) => group.items.forEach((item) => {
        previousCounts.set(String(item.id), Number(item.count) || 0);
      }));
      const refreshedGroups = groups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          count: previousCounts.get(String(item.id)) || 0,
        })),
      }));
      const summary = orderService.summarizeClothing(
        refreshedGroups,
        this.data.activeGroupKey || (refreshedGroups[0] && refreshedGroups[0].key) || '',
      );
      this.setData({ ...summary, catalogLoading: false });
      if (!refreshedGroups.length) {
        this.setData({ inlineMessage: '后端暂未返回可用的衣物分类' });
      }
    } catch (error) {
      console.error('[order-create] clothing catalog request failed', error);
      this.setData({ catalogLoading: false, inlineMessage: '衣物分类加载失败，请检查后端接口和网络配置' });
    }
  },

  selectGroup(e) {
    const activeGroupKey = e.currentTarget.dataset.key;
    if (activeGroupKey === this.data.activeGroupKey) return;
    this.setData({
      activeGroupKey,
      activeGroup: this.data.clothingGroups.find((group) => group.key === activeGroupKey),
      scrollIntoView: '',
    }, () => this.setData({ scrollIntoView: 'item-panel-top' }));
  },

  changeCount(id, delta) {
    const groups = orderService.changeItemCount(this.data.clothingGroups, id, delta);
    const summary = orderService.summarizeClothing(groups, this.data.activeGroupKey);
    this.setData({ ...summary, inlineMessage: '' });
  },
  increase(e) { this.changeCount(e.currentTarget.dataset.id, 1); },
  decrease(e) { this.changeCount(e.currentTarget.dataset.id, -1); },
  removeClothing(e) {
    const summary = orderService.summarizeClothing(orderService.removeItem(this.data.clothingGroups, e.currentTarget.dataset.id), this.data.activeGroupKey);
    this.setData({ ...summary, inlineMessage: '' });
  },

  toggleSelection() { this.setData({ showSelection: !this.data.showSelection, confirmMode: false }); },
  continueAdding() { this.setData({ showSelection: false, confirmMode: false, scrollIntoView: 'item-panel-top' }); },
  beginConfirm() {
    const cabinetFullMessage = this._scannedCabinetFullMessage(this.data.selectedStoreInfo);
    if (cabinetFullMessage) {
      this.setData({ inlineMessage: cabinetFullMessage, showSelection: false, confirmMode: false });
      return;
    }
    if (!this.data.selectedCount) {
      this.setData({ inlineMessage: '请至少选择一件衣物后再确认下单', showSelection: false, confirmMode: false });
      return;
    }
    if (!authService.isAuthenticated()) {
      this._resumeAfterLogin = 'confirm';
      this.setData({ authVisible: true, showSelection: false });
      return;
    }
    this.setData({ confirmMode: true, showSelection: false, inlineMessage: '' });
  },
  dismissLogin() {
    this._resumeAfterLogin = '';
    this.setData({ authVisible: false });
  },
  async handleLoginSuccess() {
    const resume = this._resumeAfterLogin;
    this._resumeAfterLogin = '';
    this.setData({ authVisible: false });
    await this.onShow();
    if (resume === 'submit') {
      await this.submitOrder();
    } else if (resume === 'confirm') {
      this.beginConfirm();
    }
  },
  backToEdit() { this.setData({ confirmMode: false, inlineMessage: '' }); },
  async submitOrder() {
    if (!authService.isAuthenticated()) {
      this._resumeAfterLogin = 'submit';
      this.setData({ authVisible: true });
      return;
    }
    // 跳转确认页前不要重置 confirmMode，否则当前页会先闪回底部操作栏。
    if (this._navigatingToConfirm) return;
    const user = authService.getCurrentUser() || {};
    if (!user.telephone) {
      this.setData({ inlineMessage: '请先在登录页完成手机号授权，绑定后才能提交订单', confirmMode: false });
      return;
    }
    if (!this.data.selectedCount) return;
    if (this._cabinetScanError) {
      this.setData({ inlineMessage: this._cabinetScanError, confirmMode: false });
      return;
    }
    if (this._storesLoading) {
      this.setData({ inlineMessage: '正在刷新柜机信息，请稍后再试', confirmMode: false });
      return;
    }
    if (!this.data.selectedStoreInfo.id) {
      this.setData({ inlineMessage: '当前柜机数据未同步，请稍后重试或重新选择柜机', confirmMode: false });
      wx.showToast({ title: '柜机信息还未加载完成', icon: 'none' });
      return;
    }
    if (this._isCabinetFull(this.data.selectedStoreInfo)) {
      const message = '当前选择的柜机没有可用格口，请稍后重试或选择其他柜机';
      this.setData({ inlineMessage: message, confirmMode: false });
      wx.showToast({ title: message, icon: 'none' });
      return;
    }
    if (cabinetService.availableCountForType(this.data.selectedStoreInfo, this.data.cabinetType) <= 0) {
      this.setData({ inlineMessage: '当前柜机没有所选规格的空闲格口，请切换柜机或柜型', confirmMode: false });
      wx.showToast({ title: '当前柜型暂无空闲格口', icon: 'none' });
      return;
    }
    const items = this.data.selectedItems.map((item) => ({
      id: item.id,
      categoryId: item.id,
      name: item.name,
      categoryName: item.categoryName,
      count: item.count,
      price: item.price,
      unitName: item.unitName || '件',
    }));
    if (items.some((item) => !item.categoryId || item.count <= 0)) {
      this.setData({ inlineMessage: '衣物信息不完整，请返回重新选择', confirmMode: false });
      return;
    }
    this._navigatingToConfirm = true;
    const previewRequest = {
      items: items.map((item) => ({
        categoryId: item.categoryId,
        quantity: Number(item.count),
        remark: '',
      })),
      cabinetId: this.data.selectedStoreInfo.id,
      compartmentSize: this.data.cabinetType.toUpperCase(),
    };
    let preview;
    try {
      preview = await orderApi.previewOrderPrice(previewRequest, `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    } catch (error) {
      this._navigatingToConfirm = false;
      this.setData({ inlineMessage: error.message || '价格预览失败，请稍后重试', confirmMode: false });
      wx.showToast({ title: error.message || '价格预览失败', icon: 'none' });
      return;
    }
    const previewData = preview && preview.data !== undefined ? preview.data : preview;
    const payableAmount = Number(previewData && previewData.payableAmount);
    if (!Number.isFinite(payableAmount)) {
      this._navigatingToConfirm = false;
      this.setData({ inlineMessage: '价格预览结果异常，请稍后重试', confirmMode: false });
      wx.showToast({ title: '价格预览结果异常', icon: 'none' });
      return;
    }
    const previewItems = Array.isArray(previewData.items) ? previewData.items : [];
    const pricedItems = items.map((item) => {
      const matched = previewItems.find((previewItem) => String(previewItem.categoryId) === String(item.categoryId));
      const quantity = Number(item.count) || 0;
      const itemPayable = Number(matched && matched.payableAmount);
      return Number.isFinite(itemPayable) && quantity > 0
        ? { ...item, price: itemPayable / quantity }
        : item;
    });
    const payload = {
      ...previewRequest,
      items: pricedItems,
      storeName: this.data.selectedStore,
      cabinetType: this.data.cabinetType,
      estimate: payableAmount,
      memberPriceApplied: Boolean(previewData.memberPriceApplied),
      cabinetLatitude: Number(this.data.selectedStoreInfo.latitude),
      cabinetLongitude: Number(this.data.selectedStoreInfo.longitude),
    };
    wx.navigateTo({
      url: `/pages/order-confirm/index?payload=${encodeURIComponent(JSON.stringify(payload))}`,
      fail: () => {
        this._navigatingToConfirm = false;
        wx.showToast({ title: '确认页打开失败，请重试', icon: 'none' });
      },
    });
  },
  chooseLocation() {
    // 柜机选择应展示后端返回的全部柜机；库存不足在确认下单时提示，不能提前把柜机从列表中隐藏。
    const stores = this.data.stores.filter((store) => (
      store && store.id !== undefined && store.id !== null && store.name
    ));
    if (!stores.length) {
      this.setData({ inlineMessage: '暂无可选择的柜机' });
      return;
    }
    wx.showActionSheet({
      itemList: stores.map((store) => store.name),
      success: (res) => {
        this._selectionVersion += 1;
        this._presetCabinetId = '';
        this._presetCabinet = null;
        this._cabinetScanSceneKey = '';
        this._cabinetScanError = '';
        const selectedStoreInfo = stores[res.tapIndex];
        const cabinetType = this._cabinetTypeForStore(selectedStoreInfo, this.data.cabinetType);
        this.setData({
          selectedStore: selectedStoreInfo.name,
          selectedStoreInfo,
          cabinetType,
          locationStatus: 'manual',
          locationMessage: '正在重新计算与柜机的距离',
          inlineMessage: '',
        });
        this.refreshSelectedStoreDistance(selectedStoreInfo);
      },
    });
  },
  openCabinetMap() {
    wx.navigateTo({ url: '/pages/cabinet-map/index' });
  },
  selectCabinetType(e) {
    const cabinetType = e.currentTarget.dataset.type;
    const available = cabinetService.availableCountForType(this.data.selectedStoreInfo, cabinetType);
    if (available <= 0) {
      this.setData({ inlineMessage: `当前柜机暂无${cabinetType === 'small' ? '小' : '大'}格口，请切换柜机` });
      return;
    }
    this.setData({ cabinetType, inlineMessage: '' });
  },
});
