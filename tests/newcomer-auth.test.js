const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const state = require('../miniprogram/services/newcomer-onboarding-service');

function load(file, dependencies, globals = {}) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram', file), 'utf8'), {
        module, exports: module.exports, require: (name) => dependencies[name] || {}, ...globals,
    });
    return module.exports;
}

function setup(source = { id: 'A', accountType: 'CUSTOMER' }, profile = {}) {
    const values = new Map();
    const calls = { navigation: [], modals: [], events: [], toasts: [] };
    const wx = {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        showTabBar() {},
        showToast: (value) => calls.toasts.push(value),
        showModal: (value) => calls.modals.push(value),
        navigateTo: (value) => calls.navigation.push(value.url),
        switchTab: (value) => calls.navigation.push(value.url),
        reLaunch: (value) => calls.navigation.push(value.url),
        login: ({ success }) => success({ code: 'wx-code' }),
    };
    const coordinator = load('services/newcomer-coordinator.js', { './newcomer-onboarding-service': state }, { wx });
    const session = { getToken: () => values.get('token'), consumeAuthPrompt: () => false, consumePendingLaunch: () => '' };
    const auth = load('services/auth-service.js', {
        '../api/auth': { login: async () => ({ token: 'test-token', user: source }) },
        '../api/user': { getMe: async () => profile, updateMe: async () => ({ username: 'nickname' }) },
        '../utils/session': session,
        '../utils/storage': { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
        '../constants/storage-key': { token: 'token', user: 'user' },
        '../constants/role': { ACCOUNT_TYPE_ROLE: { CUSTOMER: 'user', STAFF: 'staff', AREA_ADMIN: 'manager', SUPER_ADMIN: 'admin' },
            ADMIN_ROLES: ['staff', 'manager', 'admin'], ROLE: { USER: 'user' } },
        './newcomer-coordinator': coordinator,
    }, { wx });
    const tour = load('services/newcomer-tour.js', { './auth-service': auth, './newcomer-coordinator': coordinator,
        '../constants/newcomer-onboarding': require('../miniprogram/constants/newcomer-onboarding') }, { wx });
    function page(file) {
        let definition;
        load(file, {
            '../../services/auth-service': auth,
            '../../services/newcomer-tour': tour,
            '../../services/newcomer-coordinator': coordinator,
            '../../services/cabinet-service': { getStores: () => [], loadStores: async () => [] },
            '../../utils/session': session,
            '../../constants/role': { ROLE: { ADMIN: 'admin', MANAGER: 'manager', STAFF: 'staff' } },
            '../../api/order': { getOrders: async () => [] },
            '../../utils/scan-context': { resolvePendingLaunch: (value) => value },
        }, { wx, Page: (value) => { definition = value; }, Component: (value) => { definition = value; } });
        return { ...definition, ...definition.methods, data: { ...definition.data },
            setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); },
            createSelectorQuery() {
                const query = { select() { return query; }, boundingClientRect(callback) {
                    callback({ left: 20, top: 100, width: 150, height: 50 }); return query;
                }, exec() {} }; return query;
            },
            triggerEvent(name, detail) { calls.events.push({ name, detail }); },
        };
    }
    return { auth, coordinator, tour, page, wx, values, calls, session };
}

test('auth preserves explicit type and stable id after partial profile and nickname save', async () => {
    const env = setup({ id: 'A', accountType: 'CUSTOMER', mobile: '13800000000' });
    const result = await env.auth.login({ nickname: 'nickname' });
    assert.equal(result.user.id, 'A');
    assert.equal(result.user.onboardingAccountType, 'CUSTOMER');
    assert.equal(result.nicknameSaved, true);
    assert.equal(result.onboarding.shouldShow, true);
});

test('auth excludes default customer, role aliases, staff, admin and missing identities', async () => {
    for (const user of [{ id: 'A' }, { id: 'A', role: 'CUSTOMER' }, { id: 'A', accountType: 'STAFF' },
        { id: 'A', accountType: 'SUPER_ADMIN' }, { accountType: 'CUSTOMER' }]) {
        const env = setup(user);
        assert.equal((await env.auth.login({})).onboarding.shouldShow, false);
    }
    const env = setup();
    const result = await env.auth.login({});
    assert.equal(env.coordinator.getStatus(result.user, '').shouldShow, false);
});

test('coordinator isolates A/B, suppresses close in session, persists completion', async () => {
    const env = setup();
    const { user, token } = await env.auth.login({});
    env.coordinator.dismiss(user, token, 'close');
    assert.equal(env.coordinator.getStatus(user, token).shouldShow, false);
    const other = { ...user, id: 'B' };
    assert.equal(env.coordinator.getStatus(other, token).shouldShow, true);
    env.coordinator.dismiss(other, token, 'complete');
    assert.equal(state.getStatus(other, {}, env.wx).shouldShow, false);
    assert.equal(state.getStatus(user, {}, env.wx).shouldShow, true);
});

test('persisted explicit customers without marker remain eligible; generated default remains excluded', async () => {
    const env = setup();
    env.values.set('token', 'test-token');
    env.values.set('user', { id: 'legacy', accountType: 'CUSTOMER' });
    await env.auth.fetchAndSaveProfile();
    assert.equal(env.coordinator.getStatus(env.auth.getCurrentUser(), env.auth.getToken()).shouldShow, true);
    const missing = setup({ id: 'missing' });
    await missing.auth.login({});
    await missing.auth.fetchAndSaveProfile();
    assert.equal(missing.coordinator.getStatus(missing.auth.getCurrentUser(), missing.auth.getToken()).shouldShow, false);
});

test('manual help accepts every authenticated account despite unfamiliar account type', async () => {
    const env = setup({ id: 'legacy', accountType: 'CUSTOMER', onboardingAccountType: '' });
    env.values.set('token', 'test-token');
    env.values.set('user', { id: 'legacy', accountType: 'CUSTOMER', onboardingAccountType: '' });
    assert.equal(env.tour.openManualGuide(), true);
    assert.equal(env.calls.navigation.at(-1), '/pages/home/index');

    const unknown = setup({ id: 'unknown', accountType: 'CUSTOMER_ACCOUNT', onboardingAccountType: '' });
    unknown.values.set('token', 'test-token');
    unknown.values.set('user', { id: 'unknown', accountType: 'CUSTOMER_ACCOUNT', onboardingAccountType: '' });
    assert.equal(unknown.tour.openManualGuide(), true);

    const staff = setup({ id: 'staff', accountType: 'STAFF', onboardingAccountType: '' });
    staff.values.set('token', 'test-token');
    staff.values.set('user', { id: 'staff', accountType: 'STAFF', onboardingAccountType: '' });
    assert.equal(staff.tour.openManualGuide(), true);
    assert.equal(staff.calls.navigation.at(-1), '/pages/home/index');
});

test('manual help resolves stable identity when backend returns userId instead of id', async () => {
    const env = setup({ userId: 'backend-user-7', accountType: 'CUSTOMER' });
    const result = await env.auth.login({});
    assert.equal(result.user.id, 'backend-user-7');
    assert.equal(env.tour.openManualGuide(), true);
    assert.equal(env.calls.navigation.at(-1), '/pages/home/index');
});

test('manual help still opens for a logged-in profile without a standard user id', async () => {
    const env = setup({ username: '已登录用户', accountType: 'CUSTOMER' });
    const result = await env.auth.login({});
    assert.equal(result.user.id, '');
    assert.equal(env.tour.openManualGuide(), true);
    assert.equal(env.calls.navigation.at(-1), '/pages/home/index');
});

test('manual help opens when the token remains but cached user profile is missing', () => {
    const env = setup({ id: 'cached-user', accountType: 'CUSTOMER' });
    env.values.set('token', 'test-token');
    env.values.delete('user');
    assert.equal(env.tour.openManualGuide(), true);
    assert.equal(env.calls.navigation.at(-1), '/pages/home/index');
});

test('home waits for active order handling and never opens a second overlay', async () => {
    const env = setup();
    await env.auth.login({});
    const home = env.page('pages/home/index.js');
    home._homeVisible = true;
    home.data.handlingOrder = true;
    assert.equal(home.showNewcomerGuide(), false);
    home.data.handlingOrder = false;
    home._pendingOrderModal = true;
    assert.equal(home.showNewcomerGuide(), false);
    home._pendingOrderModal = false;
    assert.equal(home.showNewcomerGuide(), true);
    await home.checkPendingOrder();
    assert.equal(home.data.handlingOrder, false);
    assert.equal(env.calls.modals.length, 0);
});

test('home login opens guide, repeated onShow and close do not reopen it', async () => {
    const env = setup();
    const home = env.page('pages/home/index.js');
    home.onShow();
    home.data.agreementAccepted = true;
    await home.loginWithCodes('wx', 'phone');
    assert.equal(home.data.newcomerVisible, true);
    home.onShow();
    await new Promise(setImmediate);
    assert.equal(home.data.newcomerVisible, true);
    assert.equal(env.calls.modals.length, 0);
    home.handleNewcomerDismiss({ detail: { action: 'close' } });
    await new Promise(setImmediate);
    home.onShow();
    await new Promise(setImmediate);
    assert.equal(home.data.newcomerVisible, false);
});

test('full login and login sheet use same normalized session; sheet preserves order context', async () => {
    for (const file of ['pages/login/login.js', 'components/login-sheet/index.js']) {
        const env = setup();
        const page = env.page(file);
        page.data.agreementAccepted = true;
        if (file.includes('login-sheet')) {
            env.session.consumePendingLaunch = () => { throw new Error('order context must not be consumed'); };
            await page.handlePhoneNumber({ detail: { code: 'phone' } });
            await new Promise(setImmediate);
            assert.equal(env.calls.events[0].detail.user, env.auth.getCurrentUser());
            assert.equal(env.calls.events[0].detail.onboarding.shouldShow, true);
            assert.equal(env.calls.navigation.length, 0);
        } else {
            await page.loginWithCodes('wx', 'phone');
            assert.equal(env.calls.navigation[0], '/pages/home/index');
        }
        const home = env.page('pages/home/index.js');
        home.onShow();
        await new Promise(setImmediate);
        assert.equal(home.data.newcomerVisible, true);
    }
});

test('home pending launch and admin landing remain intact', async () => {
    for (const pending of [true, false]) {
        const env = setup(pending ? { id: 'A', accountType: 'CUSTOMER' } : { id: 'A', accountType: 'SUPER_ADMIN' });
        if (pending) env.session.consumePendingLaunch = () => '/pages/order-create/index';
        const home = env.page('pages/home/index.js');
        home._homeVisible = true;
        home.data.agreementAccepted = true;
        await home.loginWithCodes('wx', 'phone');
        assert.equal(env.calls.navigation[0], pending ? '/pages/order-create/index' : '/pages/admin-entry/index');
        assert.equal(home.data.newcomerVisible, false);
    }
});

test('home tutorial navigation preserves eligibility and storage failure informs without reopening', async () => {
    const env = setup();
    await env.auth.login({});
    const home = env.page('pages/home/index.js');
    home.onShow();
    await new Promise(setImmediate);
    home.handleNewcomerNext();
    assert.equal(env.calls.navigation[0], '/pages/order-create/index');
    assert.equal(env.coordinator.getStatus(env.auth.getCurrentUser(), env.auth.getToken()).shouldShow, true);
    const other = setup();
    await other.auth.login({});
    const otherHome = other.page('pages/home/index.js');
    otherHome.onShow();
    await new Promise(setImmediate);
    other.wx.setStorageSync = () => { throw new Error('quota'); };
    otherHome.handleNewcomerDismiss({ detail: { action: 'complete' } });
    assert.match(other.calls.toasts[0].title, /未保存/);
    assert.equal(otherHome.showNewcomerGuide(), false);
});

test('account switch resets guide identity and stale dismiss does not persist either user', async () => {
    const env = setup();
    await env.auth.login({});
    const home = env.page('pages/home/index.js');
    home.onShow();
    await new Promise(setImmediate);
    assert.equal(home.data.newcomerUserKey, 'A');
    const secondUser = { ...env.auth.getCurrentUser(), id: 'B' };
    env.values.set('user', secondUser);
    home.handleNewcomerDismiss({ detail: { action: 'complete' } });
    assert.equal(env.values.has(state.getStorageKey(secondUser)), false);
    assert.equal(home.showNewcomerGuide(), true);
    assert.equal(home.data.newcomerUserKey, 'B');
});
