const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(route) {
    let definition;
    const calls = { logins: 0, navigation: [] };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', route), 'utf8'), {
        require: (name) => name.includes('cabinet-service') ? { getStores: () => [] }
            : name.includes('constants/role') ? { ROLE: {} } : {},
        Page: (value) => { definition = value; },
        wx: {
            login: () => { calls.logins += 1; },
            navigateTo: ({ url }) => calls.navigation.push(url),
        },
    });
    return {
        page: { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } },
        calls,
    };
}

for (const route of ['home/index.js', 'login/login.js']) {
    test(`${route}: 协议默认不勾选，未同意时不会调用微信登录`, () => {
        const { page, calls } = loadPage(route);
        assert.equal(page.data.agreementAccepted, false);
        page.handlePhoneNumber({ detail: { code: 'phone-code' } });
        assert.equal(calls.logins, 0);
        page.changeAgreement({ detail: { value: ['agree'] } });
        page.handlePhoneNumber({ detail: { code: 'phone-code' } });
        assert.equal(calls.logins, 1);
        page.changeAgreement({ detail: { value: [] } });
        assert.equal(page.data.agreementAccepted, false);
    });
    test(`${route}: 阅读隐私政策不会自动勾选`, () => {
        const { page, calls } = loadPage(route);
        page.openAgreement({ currentTarget: { dataset: { type: 'privacy' } } });
        assert.equal(calls.navigation[0], '/pages/legal/index?type=privacy');
        assert.equal(page.data.agreementAccepted, false);
    });
}

test('首页初始不显示授权弹层', () => {
    assert.equal(loadPage('home/index.js').page.data.authVisible, false);
});
