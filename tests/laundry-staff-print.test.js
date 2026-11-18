const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const staffPage = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/laundry-staff/index.js'),
    'utf8',
);
const staffTemplate = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/laundry-staff/index.wxml'),
    'utf8',
);

test('洗衣店员工页不提供打印入口', () => {
    assert.doesNotMatch(staffPage, /openPrinter|openHistoryPrinter|pages\/printer/);
    assert.doesNotMatch(staffTemplate, /打印|bindtap="openPrinter"|bindtap="openHistoryPrinter"/);
});

test('洗衣店员工历史订单点击进入订单详情', () => {
    assert.match(staffPage, /this\.data\.mode === 'history'[\s\S]*?pages\/order-detail\/order-detail\?orderId=/);
});
