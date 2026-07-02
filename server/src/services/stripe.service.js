const Stripe = require('stripe');
const env = require('../config/env');

const enabled = Boolean(env.stripe.secretKey);
const stripe = enabled ? new Stripe(env.stripe.secretKey) : null;

function isEnabled() {
  return enabled;
}

/**
 * Creates a Stripe PaymentIntent. When no secret key is configured the service
 * runs in MOCK mode and returns a simulated intent so the end-to-end checkout
 * flow works without real credentials.
 */
async function createPaymentIntent({ amount, currency, orderNumber, metadata }) {
  // Stripe works in the smallest currency unit (paise for INR, cents for USD).
  const amountMinor = Math.round(amount * 100);

  if (!enabled) {
    return {
      mock: true,
      id: `pi_mock_${orderNumber}`,
      clientSecret: `pi_mock_${orderNumber}_secret`,
      amount: amountMinor,
      currency,
      status: 'requires_payment_method',
    };
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountMinor,
    currency,
    metadata: { orderNumber, ...metadata },
    automatic_payment_methods: { enabled: true },
  });

  return {
    mock: false,
    id: intent.id,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
  };
}

function constructWebhookEvent(rawBody, signature) {
  if (!enabled || !env.stripe.webhookSecret) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
}

async function retrievePaymentIntent(id) {
  if (!enabled) return null;
  return stripe.paymentIntents.retrieve(id);
}

/**
 * Refunds a PaymentIntent in full (AS-7.2). In mock mode (or for payments that
 * were themselves mock) it returns a simulated refund so the admin flow works
 * end-to-end without credentials.
 */
async function createRefund({ paymentIntentId, isMockPayment }) {
  if (!enabled || isMockPayment) {
    return { mock: true, id: `re_mock_${Date.now().toString(36)}`, status: 'succeeded' };
  }
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
  return { mock: false, id: refund.id, status: refund.status };
}

module.exports = { isEnabled, createPaymentIntent, constructWebhookEvent, retrievePaymentIntent, createRefund };
