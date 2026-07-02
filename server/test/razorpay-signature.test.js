// Unit tests for Razorpay HMAC verification. Env vars are set BEFORE the
// service (and its env module) load; node --test isolates files per process.
process.env.RAZORPAY_KEY_ID = 'rzp_test_unit';
process.env.RAZORPAY_KEY_SECRET = 'unit-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-webhook-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const svc = require('../src/services/razorpay.service');

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

test('accepts a correctly signed payment and rejects tampering', () => {
  const good = sign('order_A|pay_B', 'unit-secret');
  assert.equal(svc.verifyPaymentSignature({ razorpayOrderId: 'order_A', razorpayPaymentId: 'pay_B', signature: good }), true);
  assert.equal(svc.verifyPaymentSignature({ razorpayOrderId: 'order_A', razorpayPaymentId: 'pay_EVIL', signature: good }), false);
  assert.equal(svc.verifyPaymentSignature({ razorpayOrderId: 'order_X', razorpayPaymentId: 'pay_B', signature: good }), false);
  assert.equal(svc.verifyPaymentSignature({ razorpayOrderId: 'order_A', razorpayPaymentId: 'pay_B', signature: 'short' }), false);
  assert.equal(svc.verifyPaymentSignature({ razorpayOrderId: 'order_A', razorpayPaymentId: 'pay_B' }), false);
});

test('webhook events verify against the raw body and reject bad signatures', () => {
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_B', order_id: 'order_A' } } } }));
  const event = svc.constructWebhookEvent(body, sign(body, 'unit-webhook-secret'));
  assert.equal(event.event, 'payment.captured');

  assert.throws(() => svc.constructWebhookEvent(body, 'deadbeef'), /Invalid webhook signature/);
  assert.throws(() => svc.constructWebhookEvent(Buffer.concat([body, Buffer.from('x')]), sign(body, 'unit-webhook-secret')), /Invalid webhook signature/);
});
