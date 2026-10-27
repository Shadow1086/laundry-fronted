const authService = require('../../services/auth-service');
const orderApi = require('../../api/order');
const cabinetService = require('../../services/cabinet-service');
const errorUtil = require('../../utils/error');

const REASONS = ['清洁效果不满意', '衣物仍有污渍', '衣物存在异味', '其他原因'];

Page({
  data: {
    orderId: '',
    orderNo: '',
    loading: true,
    submitting: false,
    cabinets: [],
    cabinetNames: [],
    cabinetIndex: 0,
    cabinetId: '',
    cabinetName: '',
    cabinetAddress: '',
    smallAvailableCount: 0,
    largeAvailableCount: 0,
    compartmentSize: 'SMALL',
    images: [],
    reasons: REASONS,
    reasonIndex: 0,
    customReason: '',
  },

  onLoad(options) {
    if (!authService.requireLogin()) return;
    const orderId = options.orderId || '';
    if (!orderId) {
      this.setData({ loading: false });
      wx.showToast({ title: '缺少订单信息', icon: 'none' });
      return;
    }
    this.setData({ orderId });
    this.loadForm(orderId);
  },

  async loadForm(orderId) {
    try {
      const [order, stores] = await Promise.all([
        orderApi.getOrderById(orderId),
        cabinetService.loadStores(),
      ]);
      const cabinetId = order.cabinetId ?? order.depositCabinetId ?? '';
      const cabinetName = String(order.cabinetName || order.serviceSiteName || '原订单柜机');
      const cabinets = stores.filter((store) => store.id !== null && store.id !== undefined);
      let cabinetIndex = cabinets.findIndex((store) => String(store.id) === String(cabinetId));
      if (cabinetIndex < 0 && cabinetId !== '') {
        cabinetIndex = cabinets.findIndex((store) => store.name === cabinetName);
      }
      if (cabinetIndex < 0 && cabinetId !== '') {
        cabinets.unshift({ id: cabinetId, name: cabinetName, smallAvailableCount: 0, largeAvailableCount: 0 });
        cabinetIndex = 0;
      }
      if (cabinetIndex < 0) cabinetIndex = 0;
      const selected = cabinets[cabinetIndex];
      const originalSize = String(order.compartmentSize || order.requestedDepositSize || order.cabinetType || 'SMALL').toUpperCase();
      this.setData({
        orderNo: order.orderNo || String(orderId),
        cabinets,
        cabinetNames: cabinets.map((store) => store.name || '柜机'),
        cabinetIndex,
        cabinetId: selected ? selected.id : '',
        cabinetName: selected ? selected.name : '',
        cabinetAddress: selected ? selected.address || '' : '',
        smallAvailableCount: selected ? selected.smallAvailableCount || 0 : 0,
        largeAvailableCount: selected ? selected.largeAvailableCount || 0 : 0,
        compartmentSize: originalSize === 'LARGE' ? 'LARGE' : 'SMALL',
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: errorUtil.getMessage(error, '申请信息加载失败'), icon: 'none' });
    }
  },

  onCabinetChange(event) {
    const cabinetIndex = Number(event.detail.value);
    const cabinet = this.data.cabinets[cabinetIndex];
    if (!cabinet) return;
    this.setData({
      cabinetIndex,
      cabinetId: cabinet.id,
      cabinetName: cabinet.name,
      cabinetAddress: cabinet.address || '',
      smallAvailableCount: cabinet.smallAvailableCount || 0,
      largeAvailableCount: cabinet.largeAvailableCount || 0,
    });
  },

  selectSize(event) {
    this.setData({ compartmentSize: event.currentTarget.dataset.size });
  },

  onReasonChange(event) {
    this.setData({ reasonIndex: Number(event.detail.value), customReason: '' });
  },

  onCustomReasonInput(event) {
    this.setData({ customReason: event.detail.value });
  },

  takePhoto() {
    const remain = 3 - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多拍摄3张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: (result) => {
        const images = this.data.images.concat(
          (result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean),
        ).slice(0, 3);
        this.setData({ images });
      },
    });
  },

  previewPhoto(event) {
    const current = event.currentTarget.dataset.path;
    if (current) wx.previewImage({ current, urls: this.data.images });
  },

  removePhoto(event) {
    const images = this.data.images.slice();
    images.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ images });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  async submit() {
    if (this._submittingNow || this.data.submitting || this.data.loading) return;
    if (!this.data.cabinetId) {
      wx.showToast({ title: '请选择有效柜机', icon: 'none' });
      return;
    }
    if (!this.data.images.length) {
      wx.showToast({ title: '请拍摄至少1张问题照片', icon: 'none' });
      return;
    }
    const reasonLabel = REASONS[this.data.reasonIndex];
    const reason = reasonLabel === '其他原因' ? this.data.customReason.trim() : reasonLabel;
    if (!reason) {
      wx.showToast({ title: '请填写返洗原因', icon: 'none' });
      return;
    }
    this._submittingNow = true;
    this.setData({ submitting: true });
    const idempotencyKey = `rewash-${this.data.orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await orderApi.requestRewash(
        this.data.orderId,
        { reason, cabinetId: this.data.cabinetId, compartmentSize: this.data.compartmentSize },
        idempotencyKey,
        this.data.images,
      );
      wx.showToast({ title: '返洗申请已提交', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '返洗申请提交失败'), icon: 'none' });
    } finally {
      this._submittingNow = false;
      this.setData({ submitting: false });
    }
  },
});
