const generateOrderNumber = require('../utils/orderNumber');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const { claimStock, releaseStock } = require('../services/order-stock.service');
const Coupon = require('../models/Coupon');
const { priceCart } = require('../services/pricing.service');
const { quoteMatches } = require('../services/quote.service');
const { audit } = require('../services/audit.service');
const { isOpenAt } = require('../services/shop.service');
const { getStoreSettings } = require('../services/store-settings.service');

const MIN_LEAD_MS = 30 * 60 * 1000; // scheduled orders need at least 30 min notice
const MAX_AHEAD_MS = 48 * 60 * 60 * 1000; // and at most 2 days

/**
 * Validates the requested fulfilment time against opening hours.
 * Returns null (ASAP) or a Date for scheduled pre-orders.
 */
function resolveFulfilAt(raw, settings) {
  if (!raw) {
    if (!isOpenAt(new Date(), settings)) {
      throw ApiError.badRequest('The ovens are off right now — schedule a pre-order for our opening hours instead');
    }
    return null;
  }
  const when = new Date(raw);
  const now = Date.now();
  if (Number.isNaN(when.getTime())) throw ApiError.badRequest('Pick a valid time for your order');
  if (when.getTime() < now + MIN_LEAD_MS) {
    throw ApiError.badRequest('Scheduled orders need at least 30 minutes — choose a later time');
  }
  if (when.getTime() > now + MAX_AHEAD_MS) {
    throw ApiError.badRequest('We take pre-orders up to 2 days ahead — for anything bigger, send a custom-cake brief');
  }
  if (!isOpenAt(when, settings)) {
    throw ApiError.badRequest('That time is outside our opening hours — pick a time we’re open');
  }
  return when;
}

function buildFulfilment(orderType, payload) {
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  if (orderType === 'dining') {
    const customerName = text(payload.dining?.customerName);
    if (!customerName) throw ApiError.badRequest('Please provide your name for dine-in');
    return { dining: { tableNumber: text(payload.dining?.tableNumber), customerName } };
  }
  if (orderType === 'takeaway') {
    const t = payload.takeaway || {};
    const customerName = text(t.customerName);
    const phone = text(t.phone).replace(/\s/g, '');
    if (!customerName || !/^\+?[0-9]{7,15}$/.test(phone)) throw ApiError.badRequest('Takeaway requires a name and valid phone number');
    return { takeaway: { customerName, phone } };
  }
  if (orderType === 'delivery') {
    const d = Object.fromEntries(['fullAddress', 'area', 'city', 'pincode', 'landmark']
      .map((key) => [key, text(payload.delivery?.[key])]));
    if (!d.fullAddress || !d.area || !d.city || !/^[1-9][0-9]{5}$/.test(d.pincode)) {
      throw ApiError.badRequest('Delivery requires full address, area, city and a valid 6-digit pincode');
    }
    return { delivery: { fullAddress: d.fullAddress, area: d.area, city: d.city, pincode: d.pincode, landmark: d.landmark } };
  }
  throw ApiError.badRequest('Invalid order type');
}

const createOrder = asyncHandler(async (req, res) => {
  const { items, orderType, couponCode } = req.body;
  const paymentMethod = req.body.paymentMethod === 'cash' ? 'cash' : 'online';

  // Delivery always needs an account (saved address + order history); dine-in
  // and takeaway support guest checkout.
  if (orderType === 'delivery' && !req.user) {
    throw ApiError.unauthorized('Please sign in to place a delivery order');
  }

  const fulfilment = buildFulfilment(orderType, req.body);
  const settings = await getStoreSettings();
  if (settings.acceptingOrders === false) {
    throw ApiError.conflict('Online ordering is paused. Please check back when the bakery reopens.');
  }
  const fulfilAt = resolveFulfilAt(req.body.fulfilAt, settings);

  // Re-price on the server; never trust client totals.
  const { items: pricedItems, pricing, coupon } = await priceCart(items, { orderType, couponCode, settings });
  if (!quoteMatches(req.body.expectedQuote, pricedItems, pricing)) {
    return res.status(409).json({
      success: false,
      code: 'PRICE_CHANGED',
      message: 'Your order prices have changed. Review the updated summary and confirm before placing your order.',
      quote: { items: pricedItems, pricing },
    });
  }

  // Claim stock BEFORE persisting the order; roll back if anything fails.
  const claimed = await claimStock(pricedItems);
  // Record which lines actually decremented stock — cancellation restocks
  // exactly these, even if tracking is turned on/off for a product later.
  const claimedSet = new Set(claimed);
  for (const item of pricedItems) item.stockClaimed = claimedSet.has(item);

  // Atomically reserve a coupon slot (guards the usageLimit against races).
  // Cancellation returns the slot; refunds keep it (the promo was consumed).
  if (coupon) {
    const reserved = await Coupon.updateOne(
      {
        _id: coupon._id,
        $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
      },
      { $inc: { usedCount: 1 } },
    );
    if (reserved.modifiedCount === 0) {
      await releaseStock(claimed);
      throw ApiError.badRequest('That coupon has been fully redeemed');
    }
  }

  let order;
  try {
    order = await Order.create({
      orderNumber: await generateOrderNumber(),
      user: req.user ? req.user._id : null,
      items: pricedItems,
      orderType,
      fulfilAt,
      ...fulfilment,
      pricing,
      paymentMethod,
      paymentStatus: 'pending',
      orderStatus: 'placed',
      statusHistory: [{ status: 'placed', at: new Date() }],
    });
  } catch (err) {
    await releaseStock(claimed);
    if (coupon) {
      await Coupon.updateOne({ _id: coupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }).catch(() => {});
    }
    throw err;
  }

  res.status(201).json({ success: true, order });
});

const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, count: orders.length, orders });
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('items.product', 'name image slug');
  if (!order) throw ApiError.notFound('Order not found');

  if (order.source && order.source !== 'website' && req.user?.role !== 'admin') {
    throw ApiError.forbidden('Staff-entered orders are only available in the admin console');
  }

  if (order.user) {
    // Orders tied to an account are private to their owner (or an admin).
    if (!req.user || (String(order.user) !== String(req.user._id) && req.user.role !== 'admin')) {
      throw ApiError.forbidden('You can only view your own orders');
    }
  }
  // Guest orders (no user) are accessible to anyone holding the order id.
  res.json({ success: true, order });
});

// Legal lifecycle moves (AS-3.3): only forward along the flow, or to
// 'cancelled' from any non-terminal status. Terminal states never change.
const NEXT_STATUS = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// Admin only — advance an order through its lifecycle.
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!Order.STATUSES.includes(status)) throw ApiError.badRequest('Invalid order status');

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const allowed = NEXT_STATUS[order.orderStatus] || [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`Cannot move this order from "${order.orderStatus}" to "${status}"`);
  }
  // Cancellations always carry a reason (AS-3.4).
  if (status === 'cancelled' && !(note && note.trim())) {
    throw ApiError.badRequest('A reason is required to cancel an order');
  }

  const previous = order.orderStatus;
  order.orderStatus = status;
  order.statusHistory.push({ status, at: new Date(), note });
  await order.save();

  // A cancelled order hands back what it claimed: exactly the stock lines it
  // decremented, and its coupon slot (an order can only be cancelled once —
  // 'cancelled' is terminal — so this never double-releases).
  if (status === 'cancelled') {
    await releaseStock(order.items.filter((i) => i.stockClaimed));
    if (order.pricing?.couponCode) {
      await Coupon.updateOne(
        { code: order.pricing.couponCode, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
      ).catch(() => {});
    }
  }

  audit(req, {
    action: status === 'cancelled' ? 'order.cancel' : 'order.status',
    entity: 'order',
    entityId: order._id,
    summary: `${order.orderNumber}: ${previous} → ${status}${note ? ` (${note})` : ''}`,
    before: { orderStatus: previous },
    after: { orderStatus: status },
  });

  res.json({ success: true, order });
});

const validators = {
  create: [
    body('expectedQuote').isObject().withMessage('Review your order summary before placing the order'),
    body('expectedQuote.items').isArray({ min: 1 }).withMessage('Review your order items'),
    body('expectedQuote.items.*').isObject(),
    body('expectedQuote.items.*.product').isMongoId(),
    body('expectedQuote.items.*.price').isFloat({ min: 0 }),
    body('expectedQuote.items.*.quantity').isInt({ min: 1 }),
    body('expectedQuote.pricing').isObject().withMessage('Review your order total'),
    body('items').isArray({ min: 1 }).withMessage('Your cart cannot be empty'),
    body('items.*.productId').notEmpty().withMessage('Each item needs a productId'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('orderType').isIn(['dining', 'takeaway', 'delivery']).withMessage('Choose a valid order type'),
    body('paymentMethod').optional().isIn(['online', 'cash']).withMessage('Choose a valid payment method'),
    body('couponCode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 24 }).withMessage('That coupon code isn’t valid'),
    body('fulfilAt').optional({ values: 'falsy' }).isISO8601().withMessage('Pick a valid time for your order'),
  ],
};

module.exports = { createOrder, listMyOrders, getOrder, updateOrderStatus, validators };
