const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const templateModulePath = path.join(__dirname, '../miniprogram/services/printer-template.js');

function createConfirmPage() {
  let definition;
  let submittedPayload;
  const dependencies = {
    '../../services/newcomer-tour': { attachPage: (page) => page },
    '../../api/order': { createOrder: async (payload) => { submittedPayload = payload; return { data: { orderId: 'order-1' } }; } },
    '../../services/auth-service': { requireLogin: () => true },
    '../../utils/error': { getMessage: (error) => error.message },
    '../../api/service-config': { getBusinessStatus: async () => 1 },
    '../../services/location-service': {
      checkCurrentDistance: async () => ({ allowed: true, userLocation: { latitude: 40, longitude: 111 } }),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/order-confirm/index.js'), 'utf8'), {
    require: (name) => dependencies[name] || {},
    Page: (page) => { definition = page; },
    wx: { showModal() {}, showToast() {}, redirectTo() {} },
    setTimeout() {},
  });
  const page = {
    ...definition,
    data: {
      submitting: false,
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      remark: '',
      cabinetType: 'small',
      _payload: { cabinetId: 'cabinet-1', cabinetType: 'small', items: [{ categoryId: 2, count: 1 }] },
    },
    setData(value) { Object.assign(this.data, value); },
  };
  return { page, submitted: () => submittedPayload };
}

test('confirm order sends the user-entered optional order remark at the order root', async () => {
  const { page, submitted } = createConfirmPage();
  page.onRemarkInput({ detail: { value: '请轻柔洗涤' } });
  await page.confirmOrder();

  assert.equal(submitted().remark, '请轻柔洗涤');
  assert.equal(submitted().items[0].remark, '');
});

test('confirm order keeps an empty remark valid and caps input at the backend 500-character limit', async () => {
  const { page, submitted } = createConfirmPage();
  page.onRemarkInput({ detail: { value: 'x'.repeat(501) } });
  assert.equal(page.data.remark.length, 500);
  page.setData({ remark: '' });
  await page.confirmOrder();

  assert.equal(submitted().remark, '');
});

test('default label keeps the QR and replaces order number with a bounded remark', async () => {
  const { buildTemplate } = await import(`data:text/javascript;base64,${fs.readFileSync(templateModulePath).toString('base64')}`);
  const [page] = buildTemplate({
    userPhone: '13800000000',
    miniProgramCodeUrl: 'code-url',
    barcodeValue: 'fixed-order-code',
    orderNo: 'ORDER-123',
    remark: '12345678901234567890',
    storeName: '人民路洗护点',
    cabinetName: 'A 柜',
    itemSummary: '衬衫 x2',
  }, 'T50');
  const content = page.DrawObjects.map((object) => object.Content);

  assert.ok(content.includes('fixed-order-code'));
  assert.ok(content.includes('订单备注：'));
  assert.ok(content.includes('1234567890123…'));
  assert.ok(!content.includes('订单编号：'));
  assert.ok(!content.includes('ORDER-123'));
});

test('empty and custom-template remarks are stable and bounded', async () => {
  const { buildTemplate, printableRemark } = await import(`data:text/javascript;base64,${fs.readFileSync(templateModulePath).toString('base64')}`);
  assert.equal(printableRemark(''), '-');
  const [page] = buildTemplate({
    orderNo: 'ORDER-456',
    remark: '',
    template: [{ DrawObjects: [{ Content: '订单编号：' }, { Content: 'ORDER-456' }, { Content: '固定二维码' }] }],
  }, 'T50');

  assert.deepEqual(page.DrawObjects.map((object) => object.Content), ['订单备注：', '-', '固定二维码']);
  assert.equal(page.DeviceSn, 'T50');
});
