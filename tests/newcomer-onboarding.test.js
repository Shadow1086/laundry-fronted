const assert = require('node:assert/strict');
const test = require('node:test');
const onboarding = require('../miniprogram/services/newcomer-onboarding-service');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
  };
}

test('不同用户 ID 的状态相互隔离', () => {
  const storage = createStorage();
  const userA = { id: ' user-a ', accountType: 'CUSTOMER' };
  const userB = { id: 'user-b', accountType: 'CUSTOMER' };
  const result = onboarding.applyAction(userA, onboarding.ACTION.COMPLETE, storage);

  assert.equal(result.persisted, true);
  assert.equal(onboarding.getStatus(userA, {}, storage).shouldShow, false);
  assert.equal(onboarding.getStatus(userB, {}, storage).shouldShow, true);
  assert.notEqual(onboarding.getStorageKey(userA), onboarding.getStorageKey(userB));
});

test('缺失或异常 ID 与非 CUSTOMER 账号均关闭引导并不写入存储', () => {
  const storage = createStorage();
  const users = [
    { accountType: 'CUSTOMER' },
    { id: '   ', accountType: 'CUSTOMER' },
    { id: {}, accountType: 'CUSTOMER' },
    { id: 'staff-1', accountType: 'STAFF' },
    { id: 'unknown-1' },
    { id: Number.NaN, accountType: 'CUSTOMER' },
    { id: Number.POSITIVE_INFINITY, accountType: 'CUSTOMER' },
    { id: '\ud800', accountType: 'CUSTOMER' },
  ];

  for (const user of users) {
    assert.equal(onboarding.isEligibleCustomer(user), false);
    assert.equal(onboarding.getStatus(user, {}, storage).shouldShow, false);
    assert.equal(onboarding.applyAction(user, onboarding.ACTION.COMPLETE, storage).persisted, false);
  }
  assert.equal(storage.values.size, 0);
  assert.equal(onboarding.getStorageKey({ accountType: 'CUSTOMER' }), '');
  assert.equal(onboarding.getStorageKey({ id: '\ud800', accountType: 'CUSTOMER' }), '');
});

test('存储读取、写入异常时不抛错并提供安全默认值', () => {
  const throwingRead = { getStorageSync() { throw new Error('read failed'); } };
  const throwingWrite = {
    getStorageSync() { return undefined; },
    setStorageSync() { throw new Error('write failed'); },
  };
  const user = { id: 'customer-1', accountType: 'CUSTOMER' };

  assert.deepEqual(onboarding.loadState(user, throwingRead), onboarding.createDefaultState());
  const result = onboarding.applyAction(user, onboarding.ACTION.COMPLETE, throwingWrite);
  assert.equal(result.persisted, false);
  assert.equal(result.state.completed, true);
  assert.equal(onboarding.getStatus(user, {}, throwingRead).shouldShow, false);
  assert.equal(onboarding.getStatus(user, {}, throwingRead).storageAvailable, false);
});

test('JSON 字符串和现有 get/set 存储适配器可安全读写', () => {
  const user = { id: 'customer-json', accountType: 'CUSTOMER' };
  const key = onboarding.getStorageKey(user);
  const values = new Map([[key, JSON.stringify({ version: 1, completed: true, ['do' + 'NotRemind']: true })]]);
  const storage = {
    get(name) { return values.get(name); },
    set(name, value) { values.set(name, JSON.stringify(value)); },
  };
  assert.equal(onboarding.loadState(user, storage).completed, true);
  assert.deepEqual(onboarding.loadState(user, storage), { version: 1, completed: true });
});

test('旧版本和损坏状态回退到当前版本默认值', () => {
  const user = { id: 'customer-2', accountType: 'CUSTOMER' };
  const key = onboarding.getStorageKey(user);
  const legacyReminderField = ['do', 'NotRemind'].join('');
  const storage = createStorage({
    [key]: { version: 0, completed: true, [legacyReminderField]: true },
  });
  assert.deepEqual(onboarding.loadState(user, storage), onboarding.createDefaultState());
  storage.values.set(key, { version: 1, completed: 'yes', [legacyReminderField]: false });
  assert.deepEqual(onboarding.loadState(user, storage), onboarding.createDefaultState());
});

test('关闭只作用于当前会话，完成状态持久化且忽略旧提醒字段', () => {
  const storage = createStorage();
  const user = { id: 'customer-3', accountType: 'CUSTOMER' };
  const closed = onboarding.applyAction(user, onboarding.ACTION.CLOSE, storage);
  assert.equal(closed.dismissedThisSession, true);
  assert.equal(closed.persisted, false);
  assert.equal(onboarding.getStatus(user, { dismissedThisSession: true }, storage).shouldShow, false);
  assert.equal(onboarding.getStatus(user, {}, storage).shouldShow, true);

  const completed = onboarding.applyAction(user, onboarding.ACTION.COMPLETE, storage);
  assert.equal(completed.persisted, true);
  assert.equal(onboarding.getStatus(user, {}, storage).state.completed, true);
});

test('五步内容具备稳定顺序、真实状态、可执行入口和返洗要求', () => {
  assert.deepEqual(onboarding.ONBOARDING_STEPS.map((step) => step.key), [
    'place-order', 'order-status', 'order-statuses', 'pickup', 'rewash',
  ]);
  assert.equal(onboarding.ONBOARDING_STEPS.length, 5);
  assert.ok(onboarding.ONBOARDING_STEPS.every((step) => step.status === 'upcoming'
    && step.title && step.description && step.action.type === 'navigate'
    && step.action.label && step.action.route));
  assert.equal(onboarding.ONBOARDING_STEPS[0].action.route, '/pages/order-create/index');
  assert.equal(onboarding.ONBOARDING_STEPS[2].items.length, 9);
  assert.match(onboarding.ONBOARDING_STEPS[4].paragraphs[0], /1至3张问题照片/);
  assert.match(onboarding.ONBOARDING_STEPS[4].paragraphs[0], /批准/);
  assert.ok(onboarding.ONBOARDING_STEPS.every((step) => ['/pages/order-create/index', '/pages/newcomer-order-demo/index'].includes(step.action.route)));
  assert.deepEqual(onboarding.ORDER_STATUSES.map((status) => status.key), [
    'PENDING_DEPOSIT', 'WAITING_PICKUP', 'WASHING', 'WAITING_RETURN',
    'WAITING_PAYMENT_PICKUP', 'COMPLETED', 'CANCELLED', 'REWASHING', 'EXCEPTION',
  ]);
  assert.equal(onboarding.normalizeOrderStatus('created').key, 'PENDING_DEPOSIT');
  assert.equal(onboarding.normalizeOrderStatus('pending_pickup').key, 'WAITING_PICKUP');
  assert.equal(onboarding.normalizeOrderStatus('ready').key, 'WAITING_PAYMENT_PICKUP');
  assert.equal(onboarding.normalizeOrderStatus('cleaning').key, 'WASHING');
  assert.equal(onboarding.normalizeOrderStatus('completed').key, 'COMPLETED');
  assert.ok(onboarding.ONBOARDING_STEPS[2].items.every((item) => !item.label.includes('_')));
  assert.deepEqual(['created', 'cleaning', 'pending_pickup', 'ready', 'completed'].map((alias) => onboarding.normalizeOrderStatus(alias).key), [
    'PENDING_DEPOSIT', 'WASHING', 'WAITING_PICKUP', 'WAITING_PAYMENT_PICKUP', 'COMPLETED',
  ]);
  assert.equal(onboarding.normalizeOrderStatus('new_backend_state').key, 'UNKNOWN');
  assert.match(onboarding.normalizeOrderStatus('new_backend_state').description, /状态已更新/);
  assert.equal(onboarding.getStatus({ id: 'customer-4', accountType: 'CUSTOMER' }, null, createStorage()).dismissedThisSession, false);
  assert.equal(onboarding.ONBOARDING_STEPS[0].paragraphs[0].includes('确认订单'), true);
  assert.equal(onboarding.ONBOARDING_STEPS[1].paragraphs[0].includes('订单编号'), true);
  assert.equal(onboarding.ONBOARDING_STEPS[3].paragraphs[0].includes('取衣码'), true);
  assert.ok(onboarding.ORDER_STATUSES.every((status) => status.description.length > 0));
  assert.match(onboarding.ORDER_STATUSES.find((status) => status.key === 'WAITING_PICKUP').description, /取消操作/);
  assert.match(onboarding.ORDER_STATUSES.find((status) => status.key === 'WASHING').description, /取消操作/);
  assert.deepEqual(onboarding.getStepModels(2).map((step) => step.status), [
    'completed', 'completed', 'current', 'upcoming', 'upcoming',
  ]);
});
