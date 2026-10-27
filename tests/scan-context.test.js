const assert = require('node:assert/strict');
const test = require('node:test');
const scanContext = require('../miniprogram/utils/scan-context');

const key = 'abcdefghijklmnopqrstuvwx';

test('柜机小程序码支持 App 启动参数和 Page 参数', () => {
    for (const options of [
        { scene: 1047, query: { scene: `cabinet%3A${key}` } },
        { scene: `cabinet:${key}` },
        { cabinetSceneKey: key },
    ]) {
        const context = scanContext.parse(options);
        assert.equal(context.type, 'cabinet-scene');
        assert.equal(context.value, key);
    }
});

test('小程序内扫描优先解析 path 中的柜机场景', () => {
    const context = scanContext.parseScanResult({
        path: `pages/order-create/index?scene=cabinet%3A${key}`,
        result: '',
    });
    assert.equal(context.type, 'cabinet-scene');
    assert.equal(context.value, key);
});

test('兼容历史普通柜机二维码', () => {
    const context = scanContext.parseScanResult({ result: `cabinet://scan/${key}` });
    assert.equal(context.type, 'cabinet-scene');
    assert.equal(context.value, key);
});

test('订单小程序码仍进入订单场景，普通启动不误识别', () => {
    assert.equal(scanContext.parse({ scene: 1047, query: { scene: key } }).type, 'order-scene');
    assert.equal(scanContext.parse({ scene: 1001, query: {} }).type, '');
    assert.equal(scanContext.parse({ scene: 1001 }).type, '');
});

test('订单标签的登录恢复只允许区域管理员和员工进入详情', () => {
    const url = `/pages/order-detail/order-detail?scanSceneKey=${key}`;
    for (const role of ['user', 'admin', '']) {
        assert.equal(scanContext.resolvePendingLaunch(url, role), '/pages/home/index');
    }
    for (const role of ['manager', 'staff']) {
        assert.equal(scanContext.resolvePendingLaunch(url, role), url);
    }
    assert.equal(scanContext.resolvePendingLaunch('/pages/order-detail/order-detail?orderId=1001', 'user'),
        '/pages/order-detail/order-detail?orderId=1001');
    assert.equal(scanContext.resolvePendingLaunch('/pages/order-create/index', 'user'), '/pages/order-create/index');
});
