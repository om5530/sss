const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const stripeService = require('../services/stripe.service');
const razorpayService = require('../services/razorpay.service');
const { emailForOrder, notifyOrderStatus } = require('../services/notify.service');

/** Fire-and-forget "your order is confirmed" email once money arrives. */
function notifyPaid(order) {
  if (order.orderStatus !== 'confirmed') return;
  emailForOrder(order).then((email) => notifyOrderStatus(order, 'confirmed', email)).catch(() => {});
}

// Authorises a caller to act on an order's payment. Guest orders (no user) are
// accessible to anyone holding the unguessable order id; account orders are
// private to their owner.
function assertCanPay(order, user) {
  if (order.user && (!user || String(order.user) !== String(user._id))) {
    throw ApiError.forbidden();
  }
}

// Starts an online payment for an order. The amount is always taken from the
// stored order, never from the client (US-6.1). Provider precedence:
// Razorpay (live) → Stripe (legacy) → mock (no keys configured, dev demo).
const createIntent = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  assertCanPay(order, req.user);
  if (order.paymentStatus === 'paid') throw ApiError.badRequest('This order is already paid');
  if (order.paymentMethod === 'cash') {
    throw ApiError.badRequest('This order is set to cash payment — pay when you receive it');
  }

  if (razorpayService.isEnabled()) {
    const rzpOrder = await razorpayService.createOrder({
      amount: order.pricing.total,
      currency: order.pricing.currency,
      orderNumber: order.orderNumber,
      notes: { orderId: order._id.toString(), userId: req.user ? req.user._id.toString() : 'guest' },
    });

    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        $set: {
          order: order._id,
          user: req.user ? req.user._id : null,
          provider: 'razorpay',
          razorpayOrderId: rzpOrder.id,
          amount: order.pricing.total,
          currency: order.pricing.currency,
          status: 'requires_payment',
          mock: false,
        },
        // Keep every issued id — an older, still-open popup can still capture.
        $addToSet: { razorpayOrderIds: rzpOrder.id },
      },
      { upsert: true, new: true },
    );

    return res.json({
      success: true,
      provider: 'razorpay',
      keyId: razorpayService.keyId(),
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount, // paise — Checkout.js expects minor units
      currency: rzpOrder.currency,
      orderNumber: order.orderNumber,
      mock: false,
    });
  }

  const intent = await stripeService.createPaymentIntent({
    amount: order.pricing.total,
    currency: order.pricing.currency,
    orderNumber: order.orderNumber,
    metadata: { orderId: order._id.toString(), userId: req.user ? req.user._id.toString() : 'guest' },
  });

  await Payment.findOneAndUpdate(
    { order: order._id },
    {
      order: order._id,
      user: req.user ? req.user._id : null,
      provider: 'stripe',
      stripePaymentIntentId: intent.id,
      amount: order.pricing.total,
      currency: order.pricing.currency,
      status: 'requires_payment',
      mock: intent.mock,
    },
    { upsert: true, new: true },
  );

  res.json({
    success: true,
    provider: intent.mock ? 'mock' : 'stripe',
    clientSecret: intent.clientSecret,
    paymentIntentId: intent.id,
    mock: intent.mock,
    stripeEnabled: stripeService.isEnabled(),
  });
});

/** Shared "money arrived" transition used by verify + webhooks. */
function markOrderPaid(order, note) {
  order.paymentStatus = 'paid';
  if (order.orderStatus === 'placed') {
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', at: new Date(), note });
  }
}

// Client-side confirmation of a Razorpay payment: Checkout.js hands back
// (order_id, payment_id, signature); we verify the HMAC before trusting it.
// The webhook below remains the safety net if the client never returns.
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  if (!razorpayService.isEnabled()) throw ApiError.badRequest('Razorpay is not configured');

  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  assertCanPay(order, req.user);

  const { razorpayOrderId, razorpayPaymentId, signature } = req.body || {};
  const payment = await Payment.findOne({ order: order._id });
  const issuedIds = payment?.razorpayOrderIds?.length ? payment.razorpayOrderIds : [payment?.razorpayOrderId];
  if (!payment || payment.provider !== 'razorpay' || !issuedIds.includes(razorpayOrderId)) {
    throw ApiError.badRequest('This payment does not belong to this order');
  }

  if (!razorpayService.verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature })) {
    throw ApiError.badRequest('Payment verification failed');
  }

  // Idempotent — the webhook may have landed first. Never revive a refunded
  // order: the signature is a permanent HMAC and could be replayed after an
  // admin refund to flip the order back to paid.
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
    markOrderPaid(order, 'Payment confirmed');
    await order.save();
    notifyPaid(order);
  }
  if (payment.status !== 'succeeded' && payment.status !== 'refunded') {
    payment.status = 'succeeded';
    payment.razorpayPaymentId = razorpayPaymentId;
    const details = await razorpayService.fetchPayment(razorpayPaymentId);
    payment.method = details?.method || 'razorpay';
    await payment.save();
  }

  res.json({ success: true, order });
});

// Razorpay webhook — confirms/settles payment even if the customer closed the
// tab mid-checkout. Signature-verified against the raw body, idempotent.
const razorpayWebhook = asyncHandler(async (req, res) => {
  let event;
  try {
    event = razorpayService.constructWebhookEvent(req.body, req.headers['x-razorpay-signature']);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }
  if (!event) return res.status(200).json({ received: true, ignored: true });

  if (event.event === 'payment.captured' || event.event === 'payment.failed') {
    const entity = event.payload?.payment?.entity;
    const succeeded = event.event === 'payment.captured';

    // Match on ANY id ever issued for the order — a retry may have replaced
    // the "current" one while an older popup was still open and payable.
    const payment =
      entity &&
      (await Payment.findOne({
        $or: [{ razorpayOrderIds: entity.order_id }, { razorpayOrderId: entity.order_id }],
      }));
    // Never downgrade: a stale/redelivered payment.failed must not regress an
    // already-captured payment ('failed' → 'succeeded' remains allowed).
    if (payment && payment.status !== 'refunded' && !(payment.status === 'succeeded' && !succeeded)) {
      payment.status = succeeded ? 'succeeded' : 'failed';
      if (succeeded) payment.razorpayPaymentId = entity.id;
      payment.method = entity.method || payment.method;
      await payment.save();

      const order = await Order.findById(payment.order);
      if (order && order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
        if (succeeded) markOrderPaid(order, 'Payment confirmed');
        else order.paymentStatus = 'failed';
        await order.save();
        if (succeeded) notifyPaid(order);
      }
    }
  }

  res.json({ received: true });
});

// Demo-only confirmation used when Stripe keys are not configured, so the
// checkout flow can complete end-to-end in development.
const confirmMockPayment = asyncHandler(async (req, res) => {
  if (razorpayService.isEnabled() || stripeService.isEnabled()) {
    throw ApiError.badRequest('A real payment provider is configured; complete payment through it instead');
  }
  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  assertCanPay(order, req.user);
  if (order.paymentMethod === 'cash') {
    throw ApiError.badRequest('This order is set to cash payment — staff record it when the cash is received');
  }

  order.paymentStatus = 'paid';
  if (order.orderStatus === 'placed') {
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', at: new Date(), note: 'Payment received (mock)' });
  }
  await order.save();
  await Payment.findOneAndUpdate({ order: order._id }, { status: 'succeeded', method: 'mock' });

  res.json({ success: true, order });
});

const getPaymentForOrder = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ order: req.params.orderId });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (String(payment.user) !== String(req.user._id)) throw ApiError.forbidden();
  res.json({ success: true, payment });
});

// Stripe webhook — confirms payment regardless of whether the client returns
// to the success page. Verified, idempotent (US-6.2). Receives the raw body.
const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }
  if (!event) return res.status(200).json({ received: true, ignored: true });

  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const succeeded = event.type === 'payment_intent.succeeded';

    const payment = await Payment.findOne({ stripePaymentIntentId: intent.id });
    // Same no-downgrade rule as the Razorpay webhook.
    if (payment && payment.status !== 'refunded' && !(payment.status === 'succeeded' && !succeeded)) {
      payment.status = succeeded ? 'succeeded' : 'failed';
      payment.method = intent.payment_method_types && intent.payment_method_types[0];
      await payment.save();

      const order = await Order.findById(payment.order);
      if (order && order.paymentStatus !== 'paid') {
        if (succeeded) {
          order.paymentStatus = 'paid';
          if (order.orderStatus === 'placed') {
            order.orderStatus = 'confirmed';
            order.statusHistory.push({ status: 'confirmed', at: new Date(), note: 'Payment confirmed' });
          }
        } else {
          order.paymentStatus = 'failed';
        }
        await order.save();
      }
    }
  }

  res.json({ received: true });
});

module.exports = { createIntent, verifyRazorpayPayment, razorpayWebhook, confirmMockPayment, getPaymentForOrder, webhook };
