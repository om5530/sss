const crypto = require('crypto');
const Razorpay = require('razorpay');
const env = require('../config/env');

const enabled = Boolean(env.razorpay.keyId && env.razorpay.keySecret);
const client = enabled
  ? new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret })
  : null;

function isEnabled() {
  return enabled;
}

/** Public key id — safe to hand to the browser for Checkout.js. */
function keyId() {
  return env.razorpay.keyId;
}

/**
 * Creates a Razorpay Order for the given amount (major units). Checkout.js on
 * the client opens against this order id, which pins the amount server-side —
 * the client can never change what is charged.
 */
async function createOrder({ amount, currency, orderNumber, notes }) {
  const order = await client.orders.create({
    amount: Math.round(amount * 100), // paise
    currency: (currency || 'inr').toUpperCase(),
    receipt: orderNumber,
    notes: { orderNumber, ...notes },
  });
  return { id: order.id, amount: order.amount, currency: order.currency };
}

const timingSafeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

/**
 * Verifies the signature Checkout.js hands back after a successful payment:
 * HMAC-SHA256(`${orderId}|${paymentId}`, key_secret).
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!enabled || !razorpayOrderId || !razorpayPaymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return timingSafeEqual(expected, signature);
}

/**
 * Verifies a webhook delivery: HMAC-SHA256(raw body, webhook secret) against
 * the X-Razorpay-Signature header. Returns the parsed event, or null when the
 * webhook secret is not configured (event is then ignored, mirroring Stripe).
 * Throws on a bad signature so the caller can reject the request.
 */
function constructWebhookEvent(rawBody, signature) {
  if (!enabled || !env.razorpay.webhookSecret) return null;
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  if (!signature || !timingSafeEqual(expected, signature)) {
    throw new Error('Invalid webhook signature');
  }
  return JSON.parse(rawBody.toString());
}

/** Best-effort payment lookup, used to record the method (upi/card/wallet). */
async function fetchPayment(paymentId) {
  if (!enabled) return null;
  try {
    return await client.payments.fetch(paymentId);
  } catch {
    return null;
  }
}

/** Full refund of a captured payment. */
async function createRefund({ paymentId, isMockPayment }) {
  if (!enabled || isMockPayment) {
    return { mock: true, id: `rfnd_mock_${Date.now().toString(36)}`, status: 'processed' };
  }
  const refund = await client.payments.refund(paymentId, {});
  return { mock: false, id: refund.id, status: refund.status };
}

module.exports = { isEnabled, keyId, createOrder, verifyPaymentSignature, constructWebhookEvent, fetchPayment, createRefund };
