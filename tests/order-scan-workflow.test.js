const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const scanContext = require('../miniprogram/utils/scan-context');

function loadPage(relativePath, dependencies, wx) {
    const filePath = path.join(__dirname, '../miniprogram', relativePath);
    const module = { exports: {} };
    let definition;
    vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), {
        module,
        exports: module.exports,
        require: (name) => dependencies[name] || {},
        Page: (value) => { definition = value; },
        wx,
    });
    return definition;
}

function pageInstance(definition) {
    return {
        ...definition,
        data: { ...definition.data },
        setData(value) { Object.assign(this.data, value); },
    };
}

test('员工扫描场景码后按内部阶段进入到店确认或洗护完成', async () => {
    for (const [internalStage, expectedMode] of [
        ['GARMENT_RECEIVED', 'arrival'],
        ['PRICE_FINAL_CONFIRMED', 'washing'],
    ]) {
        const wx = { showToast() {} };
        const definition = loadPage('pages/laundry-staff/index.js', {
            '../../services/auth-service': { requireRole: () => true },
            '../../api/staff-order': { getStaffOrderById: async () => ({ id: 'order-1', internalStage, items: [] }) },
            '../../api/order': { getOrderByScanScene: async () => ({ orderId: 'order-1' }) },
            '../../constants/role': { ROLE: { STAFF: 'staff' } },
            '../../utils/scan-context': scanContext,
        }, wx);
        const page = pageInstance(definition);
        await page._activateByScanScene('scene-key');
        assert.equal(page.data.mode, expectedMode);
        assert.equal(page.data.stage, 'working');
    }
});

test('员工不为已完成或未知阶段订单展示可执行操作', async () => {
    const toasts = [];
    const wx = { showToast: (value) => toasts.push(value) };
    const definition = loadPage('pages/laundry-staff/index.js', {
        '../../services/auth-service': { requireRole: () => true },
        '../../api/staff-order': { getStaffOrderById: async () => ({ id: 'order-1', internalStage: 'WASH_FINISHED', items: [] }) },
        '../../api/order': { getOrderByScanScene: async () => ({ orderId: 'order-1' }) },
        '../../constants/role': { ROLE: { STAFF: 'staff' } },
        '../../utils/scan-context': scanContext,
    }, wx);
    const page = pageInstance(definition);
    await page._activateByScanScene('scene-key');
    assert.equal(page.data.stage, 'idle');
    assert.equal(toasts.length, 1);
});

test('区域管理员按内部阶段进入取衣或洗后返柜界面，未知阶段不打开操作页', () => {
    const toasts = [];
    const wx = { showToast: (value) => toasts.push(value) };
    const definition = loadPage('pages/area-manager/index.js', {
        '../../api/area-admin': {},
        '../../services/auth-service': {},
        '../../services/cabinet-service': {},
        '../../utils/scan-context': scanContext,
        '../../api/order': {},
        '../../constants/order-status': { CREATED: 'created', CLEANING: 'cleaning', READY: 'ready', COMPLETED: 'completed', PENDING_PICKUP: 'pending_pickup' },
        '../../constants/role': { ROLE: { MANAGER: 'manager' } },
        '../../services/printer-service': { default: {}, PRINT_CANVAS_SIZE: { width: 1, height: 1 } },
    }, wx);

    for (const [internalStage, expectedMode] of [
        ['DEPOSIT_CONFIRMED', 'pickup'],
        ['WASH_FINISHED', 'delivery'],
    ]) {
        const page = pageInstance(definition);
        page._showOrderFound({ id: 'order-1', internalStage, items: [] });
        assert.equal(page.data.mode, expectedMode);
        assert.equal(page.data.stage, 'order-found');
    }

    const invalid = pageInstance(definition);
    invalid._showOrderFound({ id: 'order-1', internalStage: 'RETURN_CONFIRMED', items: [] });
    assert.equal(invalid.data.stage, 'idle');
    assert.equal(toasts.length, 1);
});

test('扫码参数直接打开订单详情时仍按角色重定向，普通详情入口不受影响', async () => {
    for (const [role, expectedRoute] of [
        ['user', '/pages/home/index'],
        ['staff', '/pages/laundry-staff/index?scanEntry=1&orderId=order-1'],
        ['manager', '/pages/area-manager/index?scanEntry=1&orderId=order-1'],
        ['admin', '/pages/admin-entry/index?scanEntry=1&orderId=order-1'],
    ]) {
        const routes = [];
        const wx = { reLaunch: (value) => routes.push(value.url), showToast() {} };
        const definition = loadPage('pages/order-detail/order-detail.js', {
            '../../services/newcomer-tour': { attachPage: (value) => value },
            '../../services/auth-service': {
                isAuthenticated: () => true,
                requireLogin: () => true,
                getRole: () => role,
            },
            '../../api/order': { getOrderById: async () => { throw new Error('test detail load'); } },
            '../../api/device-command': {},
            '../../utils/error': {},
            '../../services/door-confirmation': {},
            '../../api/staff-order': {},
            '../../api/area-admin': {},
            '../../utils/scan-context': scanContext,
            '../../utils/session': { savePendingLaunch() {} },
        }, wx);
        const page = pageInstance(definition);
        page.onLoad({ scanEntry: '1', orderId: 'order-1' });
        assert.deepEqual(routes, [expectedRoute]);
    }

    const routes = [];
    const wx = { reLaunch: (value) => routes.push(value.url), showToast() {} };
    const definition = loadPage('pages/order-detail/order-detail.js', {
        '../../services/newcomer-tour': { attachPage: (value) => value },
        '../../services/auth-service': {
            isAuthenticated: () => true,
            requireLogin: () => true,
            getRole: () => 'user',
        },
        '../../api/order': { getOrderById: async () => { throw new Error('expected test request failure'); } },
        '../../api/device-command': {},
        '../../utils/error': {},
        '../../services/door-confirmation': {},
        '../../api/staff-order': {},
        '../../api/area-admin': {},
        '../../utils/scan-context': scanContext,
        '../../utils/session': { savePendingLaunch() {} },
    }, wx);
    const page = pageInstance(definition);
    page.onLoad({ orderId: 'order-1' });
    await new Promise(setImmediate);
    assert.deepEqual(routes, []);
});
