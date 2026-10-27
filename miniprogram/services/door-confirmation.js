const UNCONFIRMED_MESSAGE = '开锁命令已发送，但设备未确认';

function readOutcome(value) {
  if (value && value.status) return value;
  if (value && value.result && value.result.status) return value.result;
  return null;
}

function isUnconfirmed(error) {
  const outcome = readOutcome(error);
  return (outcome && outcome.status === 'UNCONFIRMED')
    || String(error && error.message || '').includes(UNCONFIRMED_MESSAGE);
}

function askDoorOpened() {
  return new Promise((resolve) => {
    wx.showModal({
      title: '系统未确认柜门开启',
      content: '开锁命令已发送，但设备未确认。请确认柜门是否已经开启。',
      confirmText: '已开启',
      cancelText: '未开启',
      success: ({ confirm }) => resolve(Boolean(confirm)),
      fail: () => resolve(false),
    });
  });
}

async function contactSupport() {
  const wantsHelp = await new Promise((resolve) => {
    wx.showModal({
      title: '仍未确认柜门开启',
      content: '请勿重复操作，可拨打客服电话寻求帮助。',
      confirmText: '联系客服',
      cancelText: '稍后处理',
      success: ({ confirm }) => resolve(Boolean(confirm)),
      fail: () => resolve(false),
    });
  });
  if (!wantsHelp) return;
  await callSupport();
}

async function callSupport() {
  const serviceConfigApi = require('../api/service-config');
  let result;
  try {
    result = await serviceConfigApi.getServicePhones();
  } catch (error) {
    wx.showToast({ title: '客服电话暂不可用，请稍后重试', icon: 'none' });
    return;
  }
  const records = Array.isArray(result)
    ? result
    : (result && (result.phones || result.list || result.records)) || [];
  const phones = records
    .map((item) => String(item && (item.phone || item.phoneNumber || item.telephone || item.mobile || item.number) || '').trim())
    .filter(Boolean);
  if (!phones.length) {
    wx.showToast({ title: '客服电话暂未配置', icon: 'none' });
    return;
  }
  let phone = phones[0];
  if (phones.length > 1) {
    const index = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: phones,
        success: ({ tapIndex }) => resolve(tapIndex),
        fail: () => resolve(-1),
      });
    });
    if (index < 0) return;
    phone = phones[index];
  }
  wx.makePhoneCall({
    phoneNumber: phone,
    fail: (error) => {
      if (!/cancel/i.test(String(error && error.errMsg || ''))) {
        wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
      }
    },
  });
}

async function runDoorConfirmation({ send, confirmOpened }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let outcome;
    try {
      const result = await send();
      if (result === false) throw new Error('MQTT 消息发送失败，开柜指令未发送');
      outcome = readOutcome(result);
    } catch (error) {
      outcome = readOutcome(error);
      if (!isUnconfirmed(error) && !outcome) throw error;
    }

    if (!outcome || outcome.status === 'ACKNOWLEDGED') return 'acknowledged';
    if (outcome.status !== 'UNCONFIRMED') {
      if (attempt === 1) {
        await contactSupport();
        return 'support';
      }
      throw new Error(outcome.message || '开柜指令发送失败，请稍后重试');
    }
    if (await askDoorOpened()) {
      await confirmOpened(outcome);
      return 'user-confirmed';
    }
    if (attempt === 1) {
      await contactSupport();
      return 'support';
    }
  }
  return 'support';
}

module.exports = { runDoorConfirmation, callSupport };
