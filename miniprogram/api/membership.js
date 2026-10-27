const { request } = require('../utils/request');
const env = require('../config/env');

const MEMBERSHIP_PLAN_ID = '2104236069726908417';

function purchase(idempotencyKey) {
  return request({
    url: `${env.apiBaseUrl}/api/miniapp/membership/purchase`,
    method: 'POST',
    timeout: 15000,
    data: { membershipPlanId: MEMBERSHIP_PLAN_ID },
    header: { 'Idempotency-Key': idempotencyKey },
  }).then(normalizePaymentParams);
}

function normalizePaymentParams(response) {
  let payment = response;
  for (let depth = 0; depth < 3 && payment && typeof payment === 'object'; depth += 1) {
    if (payment.timeStamp || payment.nonceStr || payment.package || payment.packageStr || payment.paySign) break;
    if (payment.data && typeof payment.data === 'object') payment = payment.data;
    else if (payment.payment && typeof payment.payment === 'object') payment = payment.payment;
    else break;
  }
  if (!payment || typeof payment !== 'object') return payment;
  return {
    ...payment,
    timeStamp: String(payment.timeStamp ?? payment.timestamp ?? payment.time_stamp ?? ''),
    nonceStr: String(payment.nonceStr ?? payment.nonce_str ?? ''),
    package: String(payment.package ?? payment.packageStr ?? payment.packageValue ?? payment.prepayPackage ?? ''),
    paySign: String(payment.paySign ?? payment.pay_sign ?? ''),
  };
}

module.exports = { purchase };
