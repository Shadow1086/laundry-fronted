const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const geometry = require('../miniprogram/utils/newcomer-geometry');

function loadGuide() {
    let definition;
    const events = [];
    const callbacks = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/components/newcomer-guide/index.js'), 'utf8'), {
        require: () => geometry,
        Component: (value) => { definition = value; },
        wx: { getWindowInfo: () => ({ windowWidth: 320, windowHeight: 640 }) },
    });
    const component = {
        ...definition.methods,
        data: { ...definition.data, visible: false, step: { title: '开始下单' }, progress: '1 / 3', target: { left: 20, top: 50, width: 100, height: 44 } },
        setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); },
        triggerEvent(name, detail = {}) { events.push({ name, detail: { ...detail } }); },
        createSelectorQuery() {
            return { select() { return this; }, boundingClientRect() { return this; }, exec(callback) { callbacks.push(callback); } };
        },
    };
    function update(values) {
        Object.assign(component.data, values);
        definition.observers['visible, userKey, step, target, progress'].call(component);
    }
    return { component, events, callbacks, update, definition };
}

test('宿主控制步骤，重复点击只发送一次，更新进度后恢复', () => {
    const { component, update, events } = loadGuide();
    update({ visible: true });
    component.previousStep();
    component.nextStep();
    component.nextStep();
    update({ target: { ...component.data.target } });
    component.nextStep();
    assert.deepEqual(events, [{ name: 'next', detail: {} }]);
    update({ progress: '2 / 3', canPrevious: true });
    component.previousStep();
    assert.equal(events[1].name, 'previous');
    assert.equal(component.data.stepIndex, undefined);
});

for (const [method, action] of [['close', 'close'], ['nextStep', 'complete']]) {
    test(`${action}只发送一次，重新打开可以操作`, () => {
        const { component, update, events } = loadGuide();
        update({ visible: true, lastStep: true });
        component[method]();
        component[method]();
        component.close();
        assert.deepEqual(events, [{ name: 'dismiss', detail: { action } }]);
        update({ visible: false });
        update({ visible: true });
        component.close();
        assert.equal(events.length, 2);
    });
}

test('隐藏或目标丢失不执行控件，不显示原点假框', () => {
    const { component, update, events } = loadGuide();
    for (const method of ['previousStep', 'nextStep', 'close']) component[method]();
    assert.deepEqual(events, []);
    update({ visible: true, target: null });
    assert.equal(component.data.layout, null);
    component.nextStep();
    assert.deepEqual(events, [{ name: 'targetmissing', detail: { reason: 'target' } }]);
});

test('真实正文高度调整布局，过期测量与卸载回调不更新布局', () => {
    const { component, update, callbacks, definition } = loadGuide();
    update({ visible: true });
    callbacks[0]([{ height: 1000 }]);
    assert.equal(component.data.layout.bubble.height, 522);
    update({ target: { left: 20, top: 500, width: 100, height: 44 } });
    const currentLayout = component.data.layout;
    callbacks[0]([{ height: 20 }]);
    assert.equal(component.data.layout, currentLayout);
    definition.lifetimes.detached.call(component);
    callbacks[1]([{ height: 20 }]);
    assert.equal(component.data.layout, currentLayout);
});

test('footer 只保留上一步和下一步，最后一步提示可从使用帮助重开', () => {
    const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/components/newcomer-guide/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '../miniprogram/components/newcomer-guide/index.wxss'), 'utf8');
    const footer = markup.slice(markup.indexOf('class="guide-footer"'));
    assert.match(footer, /bindtap="previousStep"/);
    assert.match(footer, /bindtap="nextStep"/);
    assert.match(markup, /如果想再次查看帮助，可以点击“使用帮助”/);
    assert.equal(footer.includes(['跳', '过'].join('')), false);
    assert.equal(footer.includes(['不再', '提醒'].join('')), false);
    assert.match(styles, /\.guide-footer\s*\{[^}]*height:\s*68px/s);
});
