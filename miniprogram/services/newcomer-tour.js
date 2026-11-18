const auth = require('./auth-service');
const coordinator = require('./newcomer-coordinator');
const { ORDER_STATUSES } = require('../constants/newcomer-onboarding');

const sessions = new Map();
const routes = {
    home: '/pages/home/index', create: '/pages/order-create/index',
    confirm: '/pages/order-confirm/index', rewash: '/pages/rewash-apply/index',
    orderDemo: '/pages/newcomer-order-demo/index',
};
const steps = {
    start: { page: 'home', selector: '#guide-place-order', title: '从这里下单', description: '点击这里选择衣物和投放柜机。下一步带你看看下单页面。', next: 'category' },
    category: { page: 'create', selector: '#guide-category', fallback: '#guide-cabinet', title: '选择衣物分类', description: '这里切换衣物分类，再添加需要洗护的衣物。', next: 'add' },
    add: { page: 'create', selector: '#guide-add', fallback: '#guide-cabinet', title: '添加衣物', description: '点击加号增加数量。没有可选衣物时，请等待商品加载或稍后重试。', next: 'cabinet' },
    cabinet: { page: 'create', selector: '#guide-cabinet', title: '选择投放柜机', description: '在这里切换营业点，核对地址和柜机可用情况。', next: 'confirm' },
    confirm: { page: 'create', selector: '#guide-confirm', fallback: '#guide-submit', title: '确认下单', description: '选好衣物后点击确认下单，选择柜型并核对订单。提交需要你亲自确认；教程下一步仅带你查看订单入口。', next: 'orders' },
    submit: { page: 'confirm', selector: '#guide-submit', title: '核对后提交', description: '核对衣物、柜机和预估价格后，由你点击确认下单。教程不会替你提交订单。离开后使用上一步，会回到下单页重新核对。', next: 'orders' },
    orders: { page: 'home', selector: '#guide-orders', title: '查看我的订单', description: '这里进入订单列表。教程接下来会展示一份静态订单示例，不会读取你的真实订单。', next: 'demoStatus' },
    demoStatus: { page: 'orderDemo', selector: '#demo-order-status', title: '看懂订单状态', description: '订单状态和进度会显示在这里。当前内容为教程演示，不代表真实订单。', items: ORDER_STATUSES, next: 'demoInfo' },
    demoInfo: { page: 'orderDemo', selector: '#demo-order-info', title: '订单信息', description: '订单号、联系电话、备注、柜机和处理点信息会显示在这里。备注为空时会显示“无备注”。', next: 'demoPrice' },
    demoPrice: { page: 'orderDemo', selector: '#demo-price-time', title: '价格信息', description: '这里展示预估应付和最终应付。想再次查看帮助，可以点击“使用帮助”。', last: true },
    rewashForm: { page: 'rewash', selector: '#guide-rewash-form', title: '填写返洗申请', description: '选择有效柜机、填写原因并上传1至3张问题照片。由你确认提交，提交后等待处理。', last: true },
};
const entry = { home: 'start', create: 'category', confirm: 'submit', rewash: 'rewashForm', orderDemo: 'demoStatus' };

function identity() {
    const user = auth.getCurrentUser();
    const token = auth.getToken();
    const id = user && (user.id || user.userId || user.accountId);
    const fallbackKey = typeof coordinator.getManualUserId === 'function'
        ? coordinator.getManualUserId(token) : '';
    return { user, key: id != null && String(id).trim() ? String(id).trim() : (token ? fallbackKey : ''), token };
}

function revealAdd(page) {
    if (page._tourRevealingAdd) return;
    page._tourRevealingAdd = true;
    page._tourSetData({ newcomerVisible: false, scrollIntoView: '' }, () => {
        if (!page._tourVisible) { page._tourRevealingAdd = false; return; }
        page._tourSetData({ scrollIntoView: 'guide-add' }, () => {
            refresh(page);
            page._tourRevealingAdd = false;
        });
    });
}

function refresh(page) {
    if (!page._tourVisible) return false;
    if (!entry[page._tourName]) {
        page._tourSequence += 1;
        page._tourSetData({ newcomerVisible: false });
        return false;
    }
    const { user, key, token } = identity();
    let session = sessions.get(key);
    if (!session) {
        session = { step: entry[page._tourName], history: [] };
        sessions.set(key, session);
    }
    const status = coordinator.getStatus(user, token);
    if ((!status.shouldShow && !session.manual)
        || (page._tourName === 'home' && (page.data.handlingOrder || page._pendingOrderModal))) {
        page._tourSequence += 1;
        page._tourSetData({ newcomerVisible: false });
        return false;
    }
    if (!steps[session.step]) {
        page._tourSequence += 1;
        page._tourSetData({ newcomerVisible: false });
        return false;
    }
    if (steps[session.step].page !== page._tourName) {
        session.history.push(session.step);
        session.step = entry[page._tourName];
    }
    const step = steps[session.step];
    const sequence = ++page._tourSequence;
    page._tourUserKey = key;
    const current = () => page._tourVisible && sequence === page._tourSequence && identity().key === key
        && (coordinator.getStatus(user, identity().token).shouldShow || session.manual);
    const measure = (selector, fallback) => {
        const query = page.createSelectorQuery();
        query.select(selector).boundingClientRect((rect) => {
            if (!current()) return;
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                if (fallback) measure(fallback);
                else page._tourSetData({ newcomerVisible: false });
                return;
            }
            const show = () => page._tourSetData({ newcomerVisible: true, newcomerUserKey: key,
                newcomerStep: { ...step, ...(['category', 'add'].includes(session.step) && selector === step.fallback ? { title: '暂无可选衣物', description: '当前暂无可选衣物。可先核对这里的营业点；商品加载后再选择分类、点击衣物旁的加号。' } : {}), key: session.step }, newcomerTarget: rect,
                newcomerProgress: `第 ${session.history.length + 1} 步`,
                newcomerCanPrevious: session.history.length > 0, newcomerLastStep: Boolean(step.last) });
            if (session.step === 'add' && selector === '#guide-add') {
                page.createSelectorQuery().select('.item-panel').boundingClientRect((panel) => {
                    if (!current()) return;
                    if (panel && (rect.top < panel.top || rect.top + rect.height > panel.top + panel.height)) {
                        page._tourSetData({ newcomerVisible: false });
                        if (!page._tourRevealingAdd) revealAdd(page);
                    } else show();
                }).exec();
            } else show();
        }).exec();
    };
    if (page.data.loading === true && page._tourName === 'rewash') {
        page._tourSetData({ newcomerVisible: false });
        return true;
    }
    if (typeof page.createSelectorQuery === 'function') measure(step.selector, step.fallback);
    return true;
}

function move(page, previous) {
    const { key } = identity();
    if (key !== page._tourUserKey || !page.data.newcomerVisible) return;
    const session = sessions.get(key);
    if (!session) return;
    const previousStep = session.step;
    const previousHistory = session.history.slice();
    let next = previous ? session.history.pop() : steps[session.step].next;
    if (!next) return;
    // 确认页的下单参数仅属于原页面，离开后返回实际编辑入口重新核对。
    if (previous && next === 'submit') next = 'confirm';
    if (!previous) session.history.push(session.step);
    session.step = next;
    const targetPage = steps[next].page;
    if (targetPage === page._tourName) { refresh(page); return; }
    page._tourSequence += 1;
    page._tourVisible = false;
    page._tourSetData({ newcomerVisible: false });
    let url = routes[targetPage];
    const fail = () => {
        session.step = previousStep;
        session.history = previousHistory;
        page._tourVisible = true;
        refresh(page);
        wx.showToast({ title: '页面暂时无法打开，请重试', icon: 'none' });
    };
    if (targetPage === 'home' || targetPage === 'create') { wx.switchTab({ url, fail }); return; }
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const route = routes[targetPage].slice(1);
    let existing = -1;
    pages.forEach((candidate, index) => {
        const options = candidate.options || {};
        if (candidate.route === route) existing = index;
    });
    if (existing >= 0 && existing < pages.length - 1) {
        wx.navigateBack({ delta: pages.length - 1 - existing, fail });
    } else if (pages.length >= 9) {
        wx.redirectTo({ url, fail });
    } else {
        wx.navigateTo({ url, fail });
    }
}

function dismiss(page, event) {
    const { user, key, token } = identity();
    if (key !== page._tourUserKey) { page._tourSetData({ newcomerVisible: false }); return; }
    const action = event.detail.action;
    const session = sessions.get(key);
    const result = coordinator.dismiss(user, token, action, Boolean(session && session.manual));
    if (session) session.manual = false;
    page._tourSequence += 1;
    page._tourSetData({ newcomerVisible: false });
    if (result && action === 'complete' && !result.persisted) {
        wx.showToast({ title: '提醒设置未保存，下次启动可能再次显示', icon: 'none' });
    }
    if (page._tourName !== 'home') {
        wx.switchTab({
            url: routes.home,
            fail: () => wx.showToast({ title: '暂时无法返回首页，请重试', icon: 'none' }),
        });
    }
    if (page.checkPendingOrder) page.checkPendingOrder();
}

function openManualGuide() {
    const { user, key, token } = identity();
    const status = typeof coordinator.getManualStatus === 'function'
        ? coordinator.getManualStatus(user, token) : coordinator.getStatus(user, token);
    if (!key || !status.eligible) {
        wx.showToast({
            title: !token ? '请先登录后再打开帮助' : '帮助暂时无法打开，请重新登录',
            icon: 'none',
        });
        return false;
    }
    sessions.set(key, { step: entry.home, history: [], manual: true });
    wx.switchTab({
        url: routes.home,
        fail: () => wx.showToast({ title: '帮助页面暂时无法打开，请重试', icon: 'none' }),
    });
    return true;
}

function attachPage(definition, name) {
    const ensure = (page) => {
        if (page._tourSetData) return;
        page._tourName = name;
        page._tourSequence = 0;
        page._tourSetData = page.setData.bind(page);
        page.setData = (data, callback) => page._tourSetData(data, () => {
            if (callback) callback();
            if (!Object.keys(data).every((key) => key.startsWith('newcomer'))) refresh(page);
        });
    };
    const wrapped = { ...definition, data: { ...definition.data, newcomerVisible: false } };
    for (const lifecycle of ['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPageScroll', 'onResize']) {
        wrapped[lifecycle] = function (...args) {
            ensure(this);
            if (lifecycle === 'onShow') this._tourVisible = true;
            if (lifecycle === 'onHide' || lifecycle === 'onUnload') {
                this._tourVisible = false;
                this._tourSequence += 1;
                this._tourSetData({ newcomerVisible: false });
            }
            const result = definition[lifecycle] && definition[lifecycle].apply(this, args);
            if (lifecycle !== 'onLoad') refresh(this);
            return result;
        };
    }
    wrapped.showNewcomerGuide = function () { ensure(this); this._tourVisible = this._homeVisible; return refresh(this); };
    wrapped.handleNewcomerNext = function () { move(this, false); };
    wrapped.handleNewcomerPrevious = function () { move(this, true); };
    wrapped.handleNewcomerDismiss = function (event) { dismiss(this, event); };
    wrapped.handleNewcomerScroll = function () { this._tourScrollStep = ''; refresh(this); };
    wrapped.handleNewcomerTargetMissing = function () {
        if (this._tourVisible && this.data.newcomerStep.key === 'add') { revealAdd(this); return; }
        if (!this._tourVisible || this._tourScrollStep === this.data.newcomerStep.key) return;
        this._tourScrollStep = this.data.newcomerStep.key;
        const target = this.data.newcomerTarget;
        if (name === 'home') this.setData({ newcomerScrollTop: Math.max(0, target.top - 80) });
        else if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: steps[this.data.newcomerStep.key].selector, duration: 0, success: () => refresh(this) });
    };
    return wrapped;
}

module.exports = { attachPage, openManualGuide };
