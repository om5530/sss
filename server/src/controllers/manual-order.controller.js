const crypto = require('crypto');
const { body, query } = require('express-validator');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const generateOrderNumber = require('../utils/orderNumber');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { eventSalesReport, assertEventOpen } = require('../services/event-sales.service');

const { priceCart } = require('../services/pricing.service');
const { quoteMatches } = require('../services/quote.service');
const { claimStock, releaseStock } = require('../services/order-stock.service');
const { audit } = require('../services/audit.service');
const { getStoreSettings } = require('../services/store-settings.service');
const { upiPaymentForOrder } = require('../services/upi-payment.service');

const sources = ['phone', 'walk-in', 'event'];
const methods = ['upi', 'cash'];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

function applyDiscount(pricing, requested = 0) {
  const raw = String(requested);
  const discount = Number(requested);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(discount) || discount > pricing.subtotal) {
    throw ApiError.badRequest('Discount must be between ₹0 and the subtotal, with at most two decimal places');
  }
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const tax = round2((pricing.subtotal - discount) * pricing.taxRate);
  return { ...pricing, discount, tax, total: round2(pricing.subtotal - discount + tax + pricing.deliveryFee) };
}

const quote = asyncHandler(async (req, res) => {
  const { items, pricing } = await priceCart(req.body.items, { orderType: req.body.orderType });
  res.json({ success: true, items, pricing: applyDiscount(pricing, req.body.discount ?? 0) });
});

function fulfilment(body) {
  const customer = { name: (body.customer?.name || '').trim(), phone: (body.customer?.phone || '').replace(/\s/g, '') };
  if (customer.phone && !/^\+?[0-9]{7,15}$/.test(customer.phone)) throw ApiError.badRequest('Enter a valid customer phone number');
  if (body.orderType === 'delivery') {
    const delivery = Object.fromEntries(['fullAddress', 'area', 'city', 'pincode', 'landmark']
      .map((k) => [k, (body.delivery?.[k] || '').trim()]));
    if (!delivery.fullAddress || !delivery.area || !delivery.city || !/^[1-9][0-9]{5}$/.test(delivery.pincode)) {
      throw ApiError.badRequest('Delivery needs a full address, area, city and valid 6-digit pincode');
    }
    return { customer, delivery };
  }
  return body.orderType === 'dining'
    ? { customer, dining: { customerName: customer.name, tableNumber: body.tableNumber || '' } }
    : { customer, takeaway: { customerName: customer.name, phone: customer.phone } };
}

const create = asyncHandler(async (req, res) => {
  const manualKey = `${req.user._id}/${req.body.requestKey}`;
  const manualHash = crypto.createHash('sha256').update(JSON.stringify(canonical(req.body))).digest('hex');
  const replay = async () => {
    const existing = await Order.findOne({ manualKey }).select('+manualHash');
    if (!existing) return false;
    if (existing.manualHash !== manualHash) throw ApiError.conflict('This submission was already saved with different details. Open the saved order before entering another sale.');
    res.json({ success: true, order: existing, replayed: true });
    return true;
  };
  if (await replay()) return;

  const details = fulfilment(req.body);
  const eventName = req.body.source === 'event' ? (req.body.eventName || '').trim().replace(/\s+/g, ' ') : '';
  if (req.body.source === 'event' && !eventName) throw ApiError.badRequest('Enter an event or stall name');
  await assertEventOpen({ source: req.body.source, eventName });
  const fulfilAt = req.body.fulfilAt ? new Date(req.body.fulfilAt) : null;
  if (fulfilAt && (req.body.orderStatus === 'completed' || fulfilAt <= new Date())) {
    throw ApiError.badRequest('Choose a future time for an order that still needs preparation');
  }

  const settingsPromise = getStoreSettings();
  const priced = await priceCart(req.body.items, { orderType: req.body.orderType, settings: settingsPromise });
  const items = priced.items;
  const pricing = applyDiscount(priced.pricing, req.body.discount ?? 0);
  if (!quoteMatches(req.body.expectedQuote, items, pricing)) {
    return res.status(409).json({ success: false, code: 'PRICE_CHANGED', message: 'Prices changed. Review the updated total before saving.', quote: { items, pricing } });
  }
  let upiRecipient;
  if (req.body.paymentMethod === 'upi') {
    const settings = await settingsPromise;
    const recipient = settings.upiRecipients.find((r) => r.id === (req.body.upiRecipientId || settings.defaultUpiRecipientId));
    if (!recipient) throw ApiError.badRequest('Choose a configured UPI recipient');
    upiPaymentForOrder({ pricing, orderNumber: 'CHECK' }, recipient);
    upiRecipient = { ...recipient };
  }
  const orderNumber = await generateOrderNumber();
  const claimed = await claimStock(items);
  const claimedSet = new Set(claimed);
  for (const item of items) item.stockClaimed = claimedSet.has(item);

  const now = new Date();
  const order = new Order({
    orderNumber, user: null, createdBy: req.user._id,
    source: req.body.source, eventName, ...details, notes: req.body.notes || '', upiRecipient,
    items, pricing, recipeCostSnapshot: priced.recipeCostSnapshot, fulfilAt, orderType: req.body.orderType, paymentMethod: req.body.paymentMethod,
    paymentStatus: req.body.paymentStatus,
    orderStatus: req.body.orderStatus, manualKey, manualHash,
    statusHistory: [{ status: req.body.orderStatus, at: now, note: req.body.orderStatus === 'completed' ? 'Recorded by staff after hand-over' : 'Order accepted by staff' }],
  });
  let payment;
  try {
    // Prepare the payment first. If either write fails, remove it and release stock,
    // using the same compensation pattern as website checkout.
    payment = await Payment.create({ order: order._id, user: null, provider: 'manual', method: order.paymentMethod,
      amount: pricing.total, currency: pricing.currency, status: order.paymentStatus === 'paid' ? 'succeeded' : 'requires_payment', mock: false });
    await order.save();
  } catch (err) {
    if (payment) await Payment.deleteOne({ _id: payment._id }).catch((cleanupError) => {
      console.error('[manual-order] Payment cleanup failed:', cleanupError.message);
    });
    await releaseStock(claimed);
    if (err.code === 11000 && await replay()) return;
    throw err;
  }
  audit(req, { action: 'order.create', entity: 'order', entityId: order._id,
    summary: `${order.orderNumber}: ${order.source}${eventName ? ` (${eventName})` : ''} — ₹${pricing.total}`,
    after: { source: order.source, eventName, total: pricing.total, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, orderStatus: order.orderStatus } });
  res.status(201).json({ success: true, order, payment });
});

const settle = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Order not found');
  const existing = await Order.findById(req.params.id);
  if (existing) await assertEventOpen(existing);
  const order = await Order.findOneAndUpdate({ _id: req.params.id, source: { $in: sources },
    paymentStatus: 'pending', orderStatus: { $ne: 'cancelled' } }, { $set: { paymentStatus: 'paid' } }, { new: true });
  if (!order) throw ApiError.conflict('Only an unpaid, active staff-entered order can be marked paid');
  let payment;
  try {
    payment = await Payment.findOneAndUpdate({ order: order._id }, { $set: {
      provider: 'manual', method: order.paymentMethod, amount: order.pricing.total, currency: order.pricing.currency,
      status: 'succeeded', mock: false,
    } }, { upsert: true, new: true });
  } catch (err) {
    await Order.updateOne({ _id: order._id, paymentStatus: 'paid' }, { $set: { paymentStatus: 'pending' } });
    throw err;
  }
  audit(req, { action: 'payment.manual', entity: 'payment', entityId: payment._id,
    summary: `${order.paymentMethod.toUpperCase()} received for ${order.orderNumber} (₹${order.pricing.total})`,
    before: { paymentStatus: 'pending' }, after: { paymentStatus: 'paid' } });
  res.json({ success: true, order, payment });
});

const paymentQr = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Order not found');
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!sources.includes(order.source) || order.paymentMethod !== 'upi') throw ApiError.badRequest('Payment QR is available for staff-entered UPI orders');
  if (order.paymentStatus !== 'pending' || order.orderStatus === 'cancelled') throw ApiError.conflict('This order is no longer waiting for payment');
  if (!order.upiRecipient?.upiId) throw ApiError.badRequest('This older order has no UPI recipient recorded');
  res.json({ success: true, payment: upiPaymentForOrder(order, order.upiRecipient) });
});

const changePaymentMethod = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Order not found');
  const session = await mongoose.startSession();
  let order, payment, previousMethod;
  try {
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).session(session);
      if (!order) throw ApiError.notFound('Order not found');
      if (!sources.includes(order.source) || !methods.includes(order.paymentMethod) ||
          !['pending', 'paid'].includes(order.paymentStatus) || order.orderStatus === 'cancelled') {
        throw ApiError.conflict('Only active staff-entered cash or UPI orders can have their payment method corrected');
      }
      await assertEventOpen(order, session);
      previousMethod = order.paymentMethod;
      if (previousMethod !== req.body.expectedMethod) throw ApiError.conflict('The payment method changed. Refresh the order and try again.');
      payment = await Payment.findOne({ order: order._id }).session(session);
      if (!payment || payment.provider !== 'manual' || !['requires_payment', 'succeeded'].includes(payment.status)) {
        throw ApiError.conflict('This payment cannot be corrected as a manual payment');
      }
      if (req.body.paymentMethod === 'upi' && !order.upiRecipient?.upiId) {
        const settings = await getStoreSettings();
        const recipient = settings.upiRecipients.find((r) => r.id === settings.defaultUpiRecipientId);
        if (order.paymentStatus === 'pending' && !recipient) throw ApiError.badRequest('Configure a UPI recipient before changing an unpaid order to UPI');
        if (recipient) order.upiRecipient = { ...recipient };
      }
      order.paymentMethod = req.body.paymentMethod;
      payment.method = req.body.paymentMethod;
      await order.save({ session });
      await payment.save({ session });
    });
  } finally { await session.endSession(); }
  if (previousMethod !== order.paymentMethod) audit(req, {
    action: 'payment.method', entity: 'order', entityId: order._id,
    summary: `${order.orderNumber}: payment method corrected from ${previousMethod.toUpperCase()} to ${order.paymentMethod.toUpperCase()}`,
    before: { paymentMethod: previousMethod }, after: { paymentMethod: order.paymentMethod },
  });
  res.json({ success: true, order, payment });
});

const eventReport = asyncHandler(async (req, res) => {
  res.json({ success: true, ...await eventSalesReport({ eventName: req.query.eventName || '' }) });
});

const itemRules = () => [
  body('items').isArray({ min: 1, max: 100 }), body('items.*').isObject(),
  body('items.*.productId').isMongoId(), body('items.*.quantity').isInt({ min: 1, max: 10000 }),
  body('orderType').isIn(['dining', 'takeaway', 'delivery']),
];
const validators = {
  changePaymentMethod: [body('paymentMethod').isIn(methods), body('expectedMethod').isIn(methods)],
  quote: itemRules(),
  create: [...itemRules(), body('requestKey').isUUID(4), body('source').isIn(sources),
    body('eventName').optional().isString().bail().trim().isLength({ max: 120 }),
    body('customer').optional().isObject(),
    ...['name', 'phone'].map((k) => body(`customer.${k}`).optional().isString().bail().trim().isLength({ max: k === 'name' ? 120 : 20 })),
    body('delivery').optional().isObject(),
    ...['fullAddress', 'area', 'city', 'pincode', 'landmark'].map((k) => body(`delivery.${k}`).optional().isString().bail().trim().isLength({ max: 240 })),
    body('tableNumber').optional().isString().bail().trim().isLength({ max: 40 }),
    body('notes').optional().isString().bail().trim().isLength({ max: 1000 }),
    body('fulfilAt').optional({ values: 'falsy' }).isISO8601(),
    body('paymentMethod').default('upi').isIn(methods), body('paymentStatus').isIn(['pending', 'paid']),
    body('upiRecipientId').optional().isIn(['omkar', 'harshita', 'aarchita']),
    body('orderStatus').isIn(['confirmed', 'completed']), body('expectedQuote').isObject(),
    body('expectedQuote.items').isArray({ min: 1, max: 100 }), body('expectedQuote.items.*').isObject(),
    body('expectedQuote.items.*.product').isMongoId(), body('expectedQuote.pricing').isObject(),
  ],
  report: [query('eventName').optional().isString().bail().trim().isLength({ min: 1, max: 120 })],
};

module.exports = { quote, create, settle, paymentQr, changePaymentMethod, eventReport, validators };
