const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPage({ send, allowed = true, role = 'user' } = {}) {
    let definition;
    const calls = { sends: 0, confirms: 0, navigation: [] };
    const dependencies = {
        '../../api/device-command': {
            sendDeviceCommand: async () => {
                calls.sends += 1;
                return send ? send() : { status: 'ACKNOWLEDGED' };
            },
            confirmDepositOpened: async () => { calls.confirms += 1; },
        },
        '../../services/auth-service': { getRole: () => role },
        '../../services/location-service': {
            isValidCoordinate: () => true,
            checkCurrentDistance: async () => ({
                allowed, reason: 'too-far', distanceMeters: 400,
                userLocation: { latitude: 40, longitude: 111 },
            }),
        },
        '../../constants/role': { ROLE: { USER: 'user', MANAGER: 'manager', STAFF: 'staff', ADMIN: 'admin' } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/command-result/command-result.js'), 'utf8'), {
        require: (name) => dependencies[name] || {},
        Page: (value) => { definition = value; },
        wx: {
            showModal: (options) => options.success({ confirm: false }),
            showToast() {},
            reLaunch: ({ url }) => calls.navigation.push(url),
            switchTab: ({ url }) => calls.navigation.push(url),
            navigateTo: ({ url }) => calls.navigation.push(url),
        },
    });
    const page = {
        ...definition,
        data: { ...definition.data, orderId: '1001' },
        setData(value) { Object.assign(this.data, value); },
    };
    return { page, calls };
}

test('取消距离确认不发送指令，并进入有内容的待处理状态', async () => {
    const { page, calls } = createPage({ allowed: false });
    await page._openDoor();
    assert.equal(calls.sends, 0);
    assert.equal(page.data.stage, 'idle');
    assert.equal(page.data.retrying, false);
});

test('明确失败的返回值不会被当作开柜成功', async () => {
    const { page } = createPage({ send: () => ({ status: 'DEVICE_FAILED', message: '设备明确返回开锁失败' }) });
    await page._openDoor();
    assert.equal(page.data.stage, 'error-open');
    assert.equal(page.data.unconfirmed, false);
});

test('设备未确认时保留操作标识，现场确认只提交一次', async () => {
    const { page, calls } = createPage({ send: () => ({ status: 'UNCONFIRMED', cabinetOperationId: '52' }) });
    await page._openDoor();
    assert.equal(page.data.stage, 'error-open');
    assert.equal(page.data.unconfirmed, true);
    assert.equal(page.data.cabinetOperationId, '52');
    page.confirmOpened();
    page.confirmOpened();
    assert.equal(calls.confirms, 1);
    await Promise.resolve();
    assert.equal(page.data.stage, 'confirm-close');
});

test('网络结果不确定时，取消重试确认不会再次发送指令', async () => {
    const { page, calls } = createPage({ send: () => { throw { errMsg: 'request:fail timeout' }; } });
    await page._openDoor();
    assert.equal(page.data.unconfirmed, true);
    await page.retryOpen();
    assert.equal(calls.sends, 1);
});

test('请求未完成时点击重试或确认开门，不重复发送', async () => {
    let resolve;
    const { page, calls } = createPage({ send: () => new Promise((done) => { resolve = done; }) });
    const opening = page._openDoor();
    await Promise.resolve();
    await page.retryOpen();
    page.confirmOpened();
    assert.equal(calls.sends, 1);
    assert.equal(calls.confirms, 0);
    resolve({ status: 'ACKNOWLEDGED' });
    await opening;
});

test('后端重试额度已用尽时隐藏重试入口，保留客服处理', async () => {
    const { page, calls } = createPage({ send: () => ({ status: 'FAILED', message: '开柜重试次数已用尽，请联系客服' }) });
    await page._openDoor();
    assert.equal(page.data.canRetry, false);
    await page.retryOpen();
    assert.equal(calls.sends, 1);
});

test('区域管理员返回对应工作主页', () => {
    const { page, calls } = createPage({ role: 'manager' });
    page.goHome();
    assert.equal(calls.navigation[0], '/pages/area-manager/index');
});
