const test = require('node:test');
const assert = require('node:assert/strict');

const { runDoorConfirmation } = require('../miniprogram/services/door-confirmation');

function setupWx(modalAnswers = []) {
  const calls = { modals: 0, phones: [] };
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    showModal(options) {
      calls.modals += 1;
      options.success({ confirm: Boolean(modalAnswers.shift()) });
    },
    showToast() {},
    showActionSheet(options) { options.success({ tapIndex: 0 }); },
    makePhoneCall(options) { calls.phones.push(options.phoneNumber); },
    request(options) {
      options.success({
        statusCode: 200,
        data: { code: 0, data: [{ phone: '4001234567' }] },
      });
    },
  };
  return calls;
}

test('acknowledged command continues without another send', async () => {
  setupWx();
  let sends = 0;
  const result = await runDoorConfirmation({
    send: async () => { sends += 1; return { status: 'ACKNOWLEDGED' }; },
    confirmOpened: async () => assert.fail('should not need manual confirmation'),
  });
  assert.equal(result, 'acknowledged');
  assert.equal(sends, 1);
});

test('user confirmation advances after an unconfirmed command', async () => {
  const calls = setupWx([true]);
  let sends = 0;
  let confirmedOperation;
  const result = await runDoorConfirmation({
    send: async () => {
      sends += 1;
      const error = new Error('开锁命令已发送，但设备未确认');
      error.result = { status: 'UNCONFIRMED', cabinetOperationId: 52 };
      throw error;
    },
    confirmOpened: async (outcome) => { confirmedOperation = outcome.cabinetOperationId; },
  });
  assert.equal(result, 'user-confirmed');
  assert.equal(sends, 1);
  assert.equal(confirmedOperation, 52);
  assert.equal(calls.modals, 1);
});

test('retries once only after the user says the door did not open', async () => {
  setupWx([false]);
  let sends = 0;
  const result = await runDoorConfirmation({
    send: async () => {
      sends += 1;
      return sends === 1 ? { status: 'UNCONFIRMED' } : { status: 'ACKNOWLEDGED' };
    },
    confirmOpened: async () => assert.fail('unexpected manual confirmation'),
  });
  assert.equal(result, 'acknowledged');
  assert.equal(sends, 2);
});

test('offers support after the one permitted retry is also unconfirmed', async () => {
  const calls = setupWx([false, false, true]);
  let sends = 0;
  const result = await runDoorConfirmation({
    send: async () => { sends += 1; return { status: 'UNCONFIRMED' }; },
    confirmOpened: async () => assert.fail('unexpected manual confirmation'),
  });
  assert.equal(result, 'support');
  assert.equal(sends, 2);
  assert.equal(calls.modals, 3);
  assert.deepEqual(calls.phones, ['4001234567']);
});

test('offers support if the explicitly requested retry cannot be sent', async () => {
  setupWx([false, true]);
  let sends = 0;
  const result = await runDoorConfirmation({
    send: async () => {
      sends += 1;
      if (sends === 1) return { status: 'UNCONFIRMED' };
      const error = new Error('MQTT 消息发送失败，开柜指令未发送');
      error.result = { status: 'FAILED', message: error.message };
      throw error;
    },
    confirmOpened: async () => assert.fail('unexpected manual confirmation'),
  });
  assert.equal(result, 'support');
  assert.equal(sends, 2);
});

test('does not treat a known send failure as an unconfirmed success', async () => {
  setupWx();
  await assert.rejects(runDoorConfirmation({
    send: async () => {
      const error = new Error('MQTT 消息发送失败，开柜指令未发送');
      error.result = { status: 'FAILED', message: error.message };
      throw error;
    },
    confirmOpened: async () => assert.fail('should not confirm a failed send'),
  }), /MQTT 消息发送失败/);
});

test('does not treat an explicit device rejection as an unconfirmed command', async () => {
  const calls = setupWx();
  await assert.rejects(runDoorConfirmation({
    send: async () => {
      const error = new Error('设备明确返回开锁失败');
      error.result = { status: 'DEVICE_FAILED', message: error.message };
      throw error;
    },
    confirmOpened: async () => assert.fail('should not confirm a rejected command'),
  }), /设备明确返回开锁失败/);
  assert.equal(calls.modals, 0);
});
