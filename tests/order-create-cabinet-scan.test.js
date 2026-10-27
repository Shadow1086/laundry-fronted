const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const cabinetService = require('../miniprogram/services/cabinet-service');

function createPage({ resolveCabinet, stores, locationFails = false }) {
    let definition;
    const dependencies = {
        '../../services/auth-service': { isAuthenticated: () => true },
        '../../services/cabinet-service': { ...cabinetService, loadStores: async () => stores.slice() },
        '../../services/location-service': {
            getCurrentLocation: async () => {
                if (locationFails) throw new Error('拒绝定位');
                return { latitude: 40, longitude: 111 };
            },
            distanceInMeters: cabinetService.distanceInMeters,
        },
        '../../api/cabinet': { getCabinetByScanScene: resolveCabinet },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/order-create/index.js'), 'utf8'), {
        require: (name) => dependencies[name] || {},
        Page: (value) => { definition = value; },
        wx: { showToast() {} },
        console: { warn() {} },
    });
    return {
        ...definition,
        data: { ...definition.data, selectedStoreInfo: {} },
        _selectionVersion: 0,
        setData(value) { Object.assign(this.data, value); },
    };
}

const scannedCabinet = { id: '2001', cabinetName: '扫码柜机', latitude: 41, longitude: 112, smallAvailableCount: 1 };
const nearestCabinet = { id: '2002', name: '附近柜机', latitude: 40, longitude: 111, smallAvailableCount: 5 };

test('柜机查询晚于页面显示时，等待扫码结果且不被附近柜机覆盖', async () => {
    let resolve;
    const page = createPage({ resolveCabinet: () => new Promise((done) => { resolve = done; }), stores: [nearestCabinet] });
    page._presetCabinetPromise = page._loadPresetCabinet('scene-key');
    const loading = page.initializeStores();
    assert.equal(page.data.selectedStore, '');
    resolve(scannedCabinet);
    await loading;
    assert.equal(page.data.selectedStoreInfo.id, scannedCabinet.id);
});

test('拒绝定位时仍保留扫码柜机，即使它不在附近列表中', async () => {
    const page = createPage({ resolveCabinet: async () => scannedCabinet, stores: [nearestCabinet], locationFails: true });
    page._presetCabinetPromise = page._loadPresetCabinet('scene-key');
    await page.initializeStores();
    assert.equal(page.data.selectedStoreInfo.id, scannedCabinet.id);
});

test('扫码柜机无效时，不默认选择其他柜机并保留手动选择列表', async () => {
    const page = createPage({
        resolveCabinet: async () => { throw new Error('柜机已停用'); },
        stores: [nearestCabinet],
        locationFails: true,
    });
    page._presetCabinetPromise = page._loadPresetCabinet('scene-key');
    await page.initializeStores();
    assert.equal(page.data.selectedStoreInfo.id, undefined);
    assert.equal(page.data.inlineMessage, '柜机已停用');
    assert.equal(page.data.stores.length, 1);
});

test('后续扫码或手动选柜后，旧扫码查询不能覆盖新选择', async () => {
    let resolve;
    const page = createPage({ resolveCabinet: () => new Promise((done) => { resolve = done; }), stores: [nearestCabinet] });
    const pending = page._loadPresetCabinet('old-scene');
    page._selectionVersion += 1;
    page.setData({ selectedStore: nearestCabinet.name, selectedStoreInfo: nearestCabinet });
    resolve(scannedCabinet);
    await pending;
    assert.equal(page.data.selectedStoreInfo.id, nearestCabinet.id);
});
