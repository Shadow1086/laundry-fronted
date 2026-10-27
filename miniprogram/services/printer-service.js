import bleTool from '../libs/SUPVANAPIT50PRO/BLETool.js';
import bleToothManage from '../libs/SUPVANAPIT50PRO/BLEToothManage.js';

const staffOrderApi = require('../api/staff-order');
const areaAdminApi = require('../api/area-admin');
const authService = require('./auth-service');
const LAST_PRINTER_KEY = 'lkLaundry.lastPrinter';

// SDK 按毫米乘打印精度绘制，预留到 24 点/毫米，避免画布裁掉标签。
export const PRINT_CANVAS_SIZE = { width: 60 * 24, height: 40 * 24 };

function callBluetoothApi(apiName, options) {
  return new Promise((resolve, reject) => wx[apiName]({ ...(options || {}), success: resolve, fail: reject }));
}

function sdkError(result) {
  if (!result || result.ResultCode === 0 || result.ResultCode === 100) return '';
  const message = result.ErrorMsg && (result.ErrorMsg.ErrMsg || result.ErrorMsg.message);
  return message || `打印机操作失败（${result.ResultCode}）`;
}

function textObject(content, x, y, width, height, fontSize, fontStyle = 0) {
  return { AntiColor: false, X: x, Y: y, Width: width, Height: height,
    Content: String(content || ''), FontName: '黑体', FontStyle: fontStyle,
    Align: 1, FontSize: fontSize, AutoReturn: false, Format: 'TEXT',
    X1: x, Y1: y, Orientation: 0 };
}

function buildTemplate(data, deviceName) {
  if (Array.isArray(data.template) && data.template.length) {
    return data.template.map(item => ({ ...item, DeviceSn: deviceName }));
  }
  return [{ Width: 60, Height: 40, Rotate: 2, Copies: Number(data.copies || 1),
    Density: 4, HorizontalNum: 0, VerticalNum: 0, PaperType: 1, Gap: 3,
    DeviceSn: deviceName, CutType: 2, SavePaper: false, FirstCut: 0, Margin: 1,
    Speed: 30, Direction: 1, DrawObjects: [
      textObject('用户手机号', 2, 1, 22, 4, 3, 2), textObject(data.userPhone || '-', 2, 5, 22, 3, 3),
      { ...textObject(data.miniProgramCodeUrl || '', 2, 9, 26, 26, 2), Format: 'IMAGE' },
      textObject(data.barcodeValue || '', 2, 35, 26, 3, 2),
      textObject('门店名称：', 30, 1, 28, 4, 3, 2),
      textObject(data.storeName || '-', 30, 5, 28, 3, 3), textObject('柜机名称：', 30, 11, 28, 4, 3, 2),
      textObject(data.cabinetName || '-', 30, 15, 28, 3, 3), textObject('订单编号：', 30, 21, 28, 4, 3, 2),
      textObject(data.orderNo || '-', 30, 25, 28, 3, 3), textObject('洗护衣类：', 30, 30, 28, 4, 3, 2),
      textObject(data.itemSummary || '-', 30, 34, 28, 3, 2),
    ] }];
}

function printApi() {
  return authService.getRole() === 'manager' ? areaAdminApi : staffOrderApi;
}

const service = {
  state: { status: 'idle', deviceName: '', deviceId: '', devices: [], scanning: false, printing: false, error: '' },
  listeners: [], scanTimer: null, generation: 0, foundHandler: null, connectionHandler: null, connectPromise: null,

  getState() { return { ...this.state, devices: this.state.devices.slice() }; },
  subscribe(listener) { if (typeof listener === 'function') this.listeners.push(listener); return () => { this.listeners = this.listeners.filter(item => item !== listener); }; },
  emit(patch) { this.state = { ...this.state, ...patch }; this.listeners.slice().forEach(listener => listener(this.getState())); },
  savedPrinter() { try { return wx.getStorageSync(LAST_PRINTER_KEY) || {}; } catch (e) { return {}; } },
  savePrinter(device) { try { wx.setStorageSync(LAST_PRINTER_KEY, { name: device.name, deviceId: device.deviceId }); } catch (e) {} },
  isPrinter(device) { return Boolean(device && /^T/i.test(device.name || device.localName || '')); },

  async startDiscovery({ autoConnect = false } = {}) {
    // 页面切换回来时复用现有蓝牙连接，避免重新搜索清空设备列表并覆盖连接状态。
    if (this.state.status === 'connected' && this.state.deviceName) return this.getState();
    if (this.state.scanning) return;
    const generation = ++this.generation;
    this.emit({ status: 'searching', scanning: true, devices: [], error: '' });
    try {
      await callBluetoothApi('openBluetoothAdapter');
      const adapter = await callBluetoothApi('getBluetoothAdapterState');
      if (!adapter || !adapter.available) throw new Error('手机蓝牙未开启，请开启蓝牙后重试');
      this.bindNativeEvents();
      await callBluetoothApi('startBluetoothDevicesDiscovery', { allowDuplicatesKey: true });
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => this.finishDiscovery(autoConnect), 3000);
      if (generation !== this.generation) await this.stopDiscovery(true);
    } catch (error) {
      if (generation === this.generation) this.emit({ status: 'disconnected', scanning: false, error: error.message || error.errMsg || '搜索打印机失败' });
      throw error;
    }
  },

  bindNativeEvents() {
    if (!this.foundHandler && wx.onBluetoothDeviceFound) {
      this.foundHandler = event => this.mergeDevices(event && event.devices);
      wx.onBluetoothDeviceFound(this.foundHandler);
    }
    if (!this.connectionHandler && wx.onBLEConnectionStateChange) {
      this.connectionHandler = event => {
        if (event && event.deviceId === this.state.deviceId && !event.connected) this.emit({ status: 'disconnected', deviceName: '', deviceId: '', error: '打印机连接已断开' });
      };
      wx.onBLEConnectionStateChange(this.connectionHandler);
    }
  },

  mergeDevices(devices) {
    const merged = this.state.devices.slice();
    (Array.isArray(devices) ? devices : []).forEach(device => {
      if (!device || !device.deviceId || !this.isPrinter(device)) return;
      const normalized = { ...device, name: device.name || device.localName || '' };
      const index = merged.findIndex(item => item.deviceId === normalized.deviceId);
      if (index < 0) merged.push(normalized); else merged[index] = { ...merged[index], ...normalized };
    });
    this.emit({ devices: merged });
  },

  chooseDevice() {
    const devices = this.state.devices;
    if (!devices.length) return null;
    const saved = this.savedPrinter();
    return devices.find(device => device.deviceId === saved.deviceId || device.name === saved.name)
      || devices.slice().sort((a, b) => (Number(b.RSSI) || -999) - (Number(a.RSSI) || -999))[0];
  },

  async finishDiscovery(autoConnect = false) {
    await this.stopDiscovery(true);
    if (autoConnect) {
      if (this.state.status === 'connected' && this.state.deviceName) return this.getState();
      const device = this.chooseDevice();
      if (device) return this.connect(device);
      this.emit({ status: 'disconnected', error: '未发现 T 开头的打印机' });
    }
  },

  async stopDiscovery(silent = false) {
    clearTimeout(this.scanTimer); this.scanTimer = null; this.generation++;
    if (this.foundHandler && wx.offBluetoothDeviceFound) { wx.offBluetoothDeviceFound(this.foundHandler); this.foundHandler = null; }
    try { await callBluetoothApi('stopBluetoothDevicesDiscovery'); } catch (e) {}
    if (!silent) this.emit({ scanning: false, status: this.state.deviceName ? 'connected' : 'disconnected' });
    else this.emit({ scanning: false });
  },

  async connect(device) {
    if (!device) throw new Error('未找到可连接的打印机');
    this.emit({ status: 'connecting', scanning: false, error: '', deviceName: device.name || device.localName || '' });
    try {
      await this.stopDiscovery(true);
      const result = await bleTool.connectBleDevice(device);
      if (result && sdkError(result)) throw new Error(sdkError(result));
      const deviceName = bleTool.deviceSn || device.name || device.localName || '';
      this.savePrinter({ ...device, name: deviceName });
      this.emit({ status: 'connected', connected: true, deviceName, deviceId: device.deviceId, error: '' });
      return this.getState();
    } catch (error) {
      this.emit({ status: 'disconnected', connected: false, deviceName: '', deviceId: '', error: error.message || '连接打印机失败' });
      throw error;
    }
  },

  async ensureConnected() {
    if (this.state.status === 'connected' && this.state.deviceName) return this.getState();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise(async (resolve, reject) => {
      const onChange = state => { if (state.status === 'connected') { cleanup(); resolve(state); } else if (state.status === 'disconnected' && !state.scanning && state.error) { cleanup(); reject(new Error(state.error)); } };
      const cleanup = this.subscribe(onChange);
      try { await this.startDiscovery({ autoConnect: true }); } catch (error) { cleanup(); reject(error); }
    }).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  },

  async print({ orderId, canvasText, canvasBarCode }) {
    const state = await this.ensureConnected();
    const api = printApi();
    const printData = await api.getLabelPrintData(orderId);
    if (!printData || !printData.miniProgramCodeUrl) throw new Error('订单小程序码地址为空');
    if (!bleTool.t50ProAndT80BleDevices(state.deviceName) && !bleTool.mp50BleDevices(state.deviceName) && !bleTool.gSeriesBleDevices(state.deviceName) && !bleTool.g21OrG28BleDevices(state.deviceName)) throw new Error('SDK 未识别该打印机型号');
    const pageObjects = buildTemplate(printData, state.deviceName);
    this.emit({ printing: true });
    const clientRequestId = `label-${orderId}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = async (error) => {
        if (settled) return; settled = true;
        if (error) { this.emit({ printing: false }); reject(error); return; }
        try {
          await api.recordLabelPrint(orderId, { printKind: printData.printKind || 'FIRST', copies: Number(printData.copies || 1), printerDeviceName: state.deviceName, clientRequestId });
          this.emit({ printing: false }); resolve({ printData, deviceName: state.deviceName });
        } catch (recordError) { this.emit({ printing: false }); reject(recordError); }
      };
      try {
        Promise.resolve(bleToothManage.doPrintMatrix(canvasText, pageObjects, canvasBarCode, result => {
          if (result && result.ResultCode === 100) return;
          const message = sdkError(result); finish(message ? new Error(message) : null);
        })).catch(finish);
      } catch (error) { finish(error); }
    });
  },

  async disconnect() { await bleTool.disconnectBleDevice().catch(() => {}); this.emit({ status: 'disconnected', connected: false, deviceName: '', deviceId: '' }); },
  async destroy() {
    // 页面销毁不代表蓝牙连接应断开；只清理仍在进行的搜索。
    if (this.state.scanning) await this.stopDiscovery(true);
  },
};

export default service;
