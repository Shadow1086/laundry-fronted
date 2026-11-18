const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const root = `${__dirname}/../miniprogram`;
const pageScript = fs.readFileSync(`${root}/pages/newcomer-order-demo/index.js`, 'utf8');
const pageMarkup = fs.readFileSync(`${root}/pages/newcomer-order-demo/index.wxml`, 'utf8');
const pageStyle = fs.readFileSync(`${root}/pages/newcomer-order-demo/index.wxss`, 'utf8');
const tourScript = fs.readFileSync(`${root}/services/newcomer-tour.js`, 'utf8');
const appConfig = JSON.parse(fs.readFileSync(`${root}/app.json`, 'utf8'));
const fixture = require('../miniprogram/data/newcomer-demo-order');

test('静态订单演示仅使用本地订单信息，不依赖真实订单接口或登录服务', () => {
  assert.match(pageScript, /newcomer-demo-order/);
  assert.doesNotMatch(pageScript, /order-service|api\/order|auth-service|utils\/request|orderApi/);
  assert.doesNotMatch(pageScript, /payOrder|openDeposit|cancelOrder|applyRewash|scanPickup|print|simulatePickup/);
  assert.doesNotMatch(tourScript, /pages\/order-list|pages\/order-detail|orderId/);
  assert.equal(fixture.status, '待取件');
  assert.ok(fixture.orderNo && fixture.userPhone && fixture.cabinetName);
  assert.ok(fixture.remark && fixture.estimatedPayable && fixture.finalPayable);
  assert.notEqual(fixture.userPhone, '15304704058');
  assert.notEqual(fixture.remark, '测试备注');
  assert.notEqual(fixture.orderNo, 'OR261004185241b07b8');
  assert.equal(fixture.progressSteps.length, 6);
});

test('静态订单演示只展示真实详情截图中的状态、进度、信息、价格和取消入口', () => {
  assert.ok(appConfig.pages.includes('pages/newcomer-order-demo/index'));
  assert.match(pageMarkup, /status-purple/);
  assert.match(pageMarkup, /progress-track/);
  assert.match(pageMarkup, /联系电话/);
  assert.match(pageMarkup, /order\.remark \|\| '无备注'/);
  assert.match(pageMarkup, /价格信息/);
  assert.match(pageMarkup, /取消订单/);
  assert.match(pageMarkup, /bindtap="showCancelDemo"/);
  assert.doesNotMatch(pageMarkup, /二维码|取货码|洗护衣物|门店地址|教程演示|demo-note/);
  assert.doesNotMatch(pageMarkup, /bindtap="(pay|cancelOrder|openDeposit|scan|print|apply)/);
});

test('备注和订单字段在窄屏下可换行，空备注有明确展示', () => {
  assert.match(pageStyle, /overflow-wrap:\s*anywhere/);
  assert.match(pageStyle, /word-break:\s*break-all/);
  assert.match(pageStyle, /max-width:\s*72%/);
  assert.match(pageMarkup, /无备注/);
});
