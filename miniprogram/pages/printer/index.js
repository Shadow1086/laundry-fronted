import printerService, { PRINT_CANVAS_SIZE } from '../../services/printer-service';
import bleTool from '../../libs/SUPVANAPIT50PRO/BLETool.js';

Page({
  data: {
    orderId: '', printData: null, devices: [], scanning: false, scanCompleted: false,
    connected: false, deviceName: '', printing: false, status: 'idle',
    templateWidth: PRINT_CANVAS_SIZE.width, templateHeight: PRINT_CANVAS_SIZE.height, barCodeWidth: 214, barCodeHeight: 72,
    qrCodeWidth: 20, qrCodeHeight: 20, pixelRatio: 2,
  },
  onLoad(options) {
    this.setData({ orderId: String(options.orderId || ''), pixelRatio: wx.getWindowInfo().pixelRatio,
      canvasText: wx.createCanvasContext('Canvas', this), canvasBarCode: wx.createSelectorQuery().in(this) });
    const syncState = state => this.setData({ ...state, connected: state.status === 'connected', scanCompleted: !state.scanning && state.status !== 'searching' });
    syncState(printerService.getState());
    this.unsubscribe = printerService.subscribe(syncState);
    if (this.data.orderId) this.loadPrintData();
  },
  async loadPrintData() {
    try { const staffOrderApi = require('../../api/staff-order'); this.setData({ printData: await staffOrderApi.getLabelPrintData(this.data.orderId) }); }
    catch (error) { wx.showToast({ title: error.message || '打印数据加载失败', icon: 'none' }); }
  },
  async scan() { try { await printerService.startDiscovery(); } catch (error) { wx.showToast({ title: error.message || '搜索打印机失败', icon: 'none' }); } },
  async stopScan() { await printerService.stopDiscovery(); },
  async connect(event) {
    const device = printerService.getState().devices[Number(event.currentTarget.dataset.index)];
    try { await printerService.connect(device); } catch (error) { wx.showToast({ title: error.message || '连接打印机失败', icon: 'none' }); }
  },
  async disconnect() { await printerService.disconnect(); },
  async print() {
    if (!this.data.orderId) return wx.showToast({ title: '缺少订单号', icon: 'none' });
    try { await printerService.print({ orderId: this.data.orderId, canvasText: this.data.canvasText, canvasBarCode: this.data.canvasBarCode }); wx.showToast({ title: '打印完成', icon: 'success' }); }
    catch (error) { wx.showToast({ title: error.message || '打印失败', icon: 'none' }); }
  },
  async stopPrint() {
    try { await bleTool.stopPrint(() => {}); }
    finally { this.setData({ printing: false }); }
  },
  onUnload() { if (this.unsubscribe) this.unsubscribe(); printerService.destroy(); },
});
