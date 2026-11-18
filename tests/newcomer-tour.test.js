const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const constants = require('../miniprogram/constants/newcomer-onboarding');

function setup(stack = []) {
    const navigation = [];
    const dismissed = new Set();
    const rectangles = {};
    let user = { id: 'A' };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('miniprogram/services/newcomer-tour.js', 'utf8'), {
        getCurrentPages: () => stack,
        module,
        require: (name) => ({
            './auth-service': { getCurrentUser: () => user, getToken: () => 'token' },
            './newcomer-coordinator': {
                getStatus: (value) => ({ shouldShow: !dismissed.has(value.id), eligible: true }),
                dismiss: (value) => { dismissed.add(value.id); return { persisted: true }; },
            },
            '../constants/newcomer-onboarding': constants,
        })[name],
        wx: {
            switchTab: ({ url }) => navigation.push(url),
            navigateTo: ({ url }) => {
                navigation.push(url);
                stack.push({ route: url.split('?')[0].slice(1), options: {} });
            },
            navigateBack: ({ delta }) => stack.splice(stack.length - delta, delta),
            redirectTo: ({ url }) => {
                navigation.push(url);
                stack[stack.length - 1] = { route: url.split('?')[0].slice(1), options: {} };
            },
        },
    });
    function page(name, data = {}, missing = [], delayed = false) {
        const pending = [];
        const selected = [];
        const definition = module.exports.attachPage({ data }, name);
        const instance = {
            ...definition,
            data: { ...definition.data },
            setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); },
            createSelectorQuery() {
                let selector;
                const query = {
                    select(value) { selector = value; selected.push(value); return query; },
                    boundingClientRect(callback) {
                        const run = () => callback(missing.includes(selector) ? null : rectangles[selector] || { left: 10, top: 80, width: 120, height: 40 });
                        if (delayed) pending.push(run); else run();
                        return query;
                    },
                    exec() {},
                };
                return query;
            },
        };
        instance.onShow();
        return { instance, pending, selected };
    }
    return { page, navigation, rectangles, openManualGuide: module.exports.openManualGuide,
        switchUser: () => { user = { id: 'B' }; } };
}

test('引导从首页进入下单页，再进入静态订单演示页，不传递真实订单编号', () => {
    const env = setup();
    const home = env.page('home').instance;
    home.handleNewcomerNext();
    assert.equal(env.navigation.at(-1), '/pages/order-create/index');
    home.onHide();
    const create = env.page('create').instance;
    for (let index = 0; index < 4; index += 1) create.handleNewcomerNext();
    assert.equal(env.navigation.at(-1), '/pages/home/index');
    create.onHide();
    home.onShow();
    home.handleNewcomerNext();
    assert.equal(env.navigation.at(-1), '/pages/newcomer-order-demo/index');
    assert.equal(env.navigation.some((url) => url.includes('orderId=')), false);
});

test('静态订单演示步骤在同一页面前进、返回并完成引导', () => {
    const env = setup();
    const demo = env.page('orderDemo').instance;
    assert.equal(demo.data.newcomerStep.key, 'demoStatus');
    demo.handleNewcomerNext();
    assert.equal(demo.data.newcomerStep.key, 'demoInfo');
    demo.handleNewcomerNext();
    assert.equal(demo.data.newcomerStep.key, 'demoPrice');
    demo.handleNewcomerPrevious();
    assert.equal(demo.data.newcomerStep.key, 'demoInfo');
    demo.handleNewcomerNext();
    demo.handleNewcomerNext();
    demo.handleNewcomerNext();
    assert.equal(demo.data.newcomerLastStep, true);
    demo.handleNewcomerDismiss({ detail: { action: 'complete' } });
    assert.equal(demo.data.newcomerVisible, false);
    assert.equal(env.navigation.at(-1), '/pages/home/index');
});

test('从订单演示页关闭引导也返回首页', () => {
    const env = setup();
    const demo = env.page('orderDemo').instance;
    demo.handleNewcomerDismiss({ detail: { action: 'close' } });
    assert.equal(demo.data.newcomerVisible, false);
    assert.equal(env.navigation.at(-1), '/pages/home/index');
});

test('真实订单列表和详情页不再被教程接管', () => {
    const env = setup();
    assert.equal(env.page('list').instance.data.newcomerVisible, false);
    assert.equal(env.page('detail').instance.data.newcomerVisible, false);
});

test('页面隐藏时丢弃待处理的选择器测量', () => {
    const env = setup();
    const demo = env.page('orderDemo', {}, [], true);
    demo.instance.onHide();
    demo.pending.forEach((callback) => callback());
    assert.equal(demo.instance.data.newcomerVisible, false);
});

test('账号切换后从第一步建立独立引导进度', () => {
    const env = setup();
    const home = env.page('home');
    env.switchUser();
    home.instance.onShow();
    assert.equal(home.instance.data.newcomerUserKey, 'B');
    assert.equal(home.instance.data.newcomerStep.key, 'start');
});

test('使用帮助可重新打开已完成的引导并从第一步开始', () => {
    const env = setup();
    const home = env.page('home').instance;
    home.handleNewcomerDismiss({ detail: { action: 'complete' } });
    assert.equal(env.openManualGuide(), true);
    home.onShow();
    assert.equal(home.data.newcomerStep.key, 'start');
    assert.equal(home.data.newcomerVisible, true);
});

test('订单演示页包含全部状态说明', () => {
    const env = setup();
    const demo = env.page('orderDemo').instance;
    assert.deepEqual(demo.data.newcomerStep.items.map((item) => item.key), constants.ORDER_STATUSES.map((item) => item.key));
});

test('空商品时引导回退到已有柜机目标并可继续', () => {
    const env = setup();
    const create = env.page('create', {}, ['#guide-category', '#guide-add']);
    assert.equal(create.selected.at(-1), '#guide-cabinet');
    assert.equal(create.instance.data.newcomerVisible, true);
    create.instance.handleNewcomerNext();
    assert.equal(create.instance.data.newcomerStep.key, 'add');
});

test('从确认页离开后上一步返回下单编辑页重新核对', () => {
    const env = setup();
    const confirm = env.page('confirm').instance;
    confirm.handleNewcomerNext();
    confirm.onHide();
    const home = env.page('home').instance;
    home.handleNewcomerPrevious();
    assert.equal(env.navigation.at(-1), '/pages/order-create/index');
    const create = env.page('create').instance;
    assert.equal(create.data.newcomerStep.key, 'confirm');
});

test('教程内部滚动只重新测量当前目标', () => {
    const env = setup();
    const demo = env.page('orderDemo');
    const before = demo.selected.length;
    demo.instance.handleNewcomerScroll();
    assert.equal(demo.selected.length, before + 1);
    assert.equal(demo.instance.data.newcomerStep.key, 'demoStatus');
});

test('页面栈达到上限时通过替换路由进入静态演示页', () => {
    const stack = Array.from({ length: 9 }, (_, index) => ({ route: `pages/other/${index}` }));
    const env = setup(stack);
    const home = env.page('home').instance;
    home.handleNewcomerNext();
    const create = env.page('create').instance;
    for (let index = 0; index < 4; index += 1) create.handleNewcomerNext();
    create.onHide();
    const resumedHome = env.page('home').instance;
    resumedHome.handleNewcomerNext();
    assert.equal(stack.length, 9);
    assert.equal(env.navigation.at(-1), '/pages/newcomer-order-demo/index');
    assert.equal(stack.at(-1).route, 'pages/newcomer-order-demo/index');
});

test('加号目标被列表裁切时先滚入可视区域再展示引导', () => {
    const env = setup();
    env.rectangles['.item-panel'] = { left: 0, top: 100, width: 300, height: 400 };
    env.rectangles['#guide-add'] = { left: 200, top: -40, width: 40, height: 40 };
    const create = env.page('create').instance;
    create.handleNewcomerNext();
    assert.equal(create.data.newcomerVisible, false);
    assert.equal(create.data.scrollIntoView, 'guide-add');
});
