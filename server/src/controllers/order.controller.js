const crypto = require('crypto');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const { priceCart } = require('../services/pricing.service');
const { audit } = require('../services/audit.service');
const { emailForOrder, notifyOrderPlaced, notifyOrderStatus } = require('../services/notify.service');

/**
 * Atomically claims stock for every tracked product in the order.
 * Returns the list of successful decrements so a later failure can roll back.
 * Untracked products (stockCount: null) are skipped entirely.
 */
async function claimStock(lineItems) {
  const claimed = [];
  try {
    for (const item of lineItems) {
      const res = await Product.updateOne(
        { _id: item.product, stockCount: { $ne: null, $gte: item.quantity } },
        { $inc: { stockCount: -item.quantity } },
      );
      if (res.matchedCount === 0) {
        // Either untracked (fine) or insufficient stock (conflict).
        const p = await Product.findById(item.product).select('name stockCount');
        if (p && p.stockCount != null) {
          throw ApiError.conflict(
            p.stockCount > 0
              ? `Only ${p.stockCount} × "${p.name}" left today — please adjust your cart`
              : `"${p.name}" just sold out — please remove it from your cart`,
          );
        }
        continue; // untracked
      }
      claimed.push(item);
      // Sold out → hide from the menu automatically.
      await Product.updateOne({ _id: item.product, stockCount: { $lte: 0 } }, { $set: { available: false } });
    }
    return claimed;
  } catch (err) {
    await releaseStock(claimed);
    throw err;
  }
}

/** Returns claimed stock (order failed to persist, or was cancelled). */
async function releaseStock(lineItems) {
  for (const item of lineItems) {
    // Read the BEFORE state so we only undo what the sell-out rule itself did:
    // a product an admin hid by hand (stock still > 0) must stay hidden.
    const prev = await Product.findOneAndUpdate(
      { _id: item.product, stockCount: { $ne: null } },
      { $inc: { stockCount: item.quantity } },
    )
      .select('stockCount archived')
      .catch((err) => {
        console.error('[stock] release failed:', err.message);
        return null;
      });
    if (prev && prev.stockCount <= 0 && !prev.archived) {
      await Product.updateOne(
        { _id: item.product, stockCount: { $gt: 0 } },
        { $set: { available: true } },
      ).catch(() => {});
    }
  }
}

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `BC-${ts}-${rand}`;
}

function buildFulfilment(orderType, payload) {
  if (orderType === 'dining') {
    return { dining: { tableNumber: payload.dining?.tableNumber, customerName: payload.dining?.customerName } };
  }
  if (orderType === 'takeaway') {
    const t = payload.takeaway || {};
    if (!t.customerName || !t.phone) throw ApiError.badRequest('Takeaway requires a name and phone number');
    return { takeaway: { customerName: t.customerName, phone: t.phone } };
  }
  if (orderType === 'delivery') {
    const d = payload.delivery || {};
    if (!d.fullAddress || !d.city || !d.pincode) {
      throw ApiError.badRequest('Delivery requires full address, city and pincode');
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

  // Re-price on the server; never trust client totals.
  const { items: pricedItems, pricing, coupon } = await priceCart(items, { orderType, couponCode });

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
      orderNumber: generateOrderNumber(),
      user: req.user ? req.user._id : null,
      items: pricedItems,
      orderType,
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

  emailForOrder(order).then((email) => notifyOrderPlaced(order, email)).catch(() => {});

  res.status(201).json({ success: true, order });
});

const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, count: orders.length, orders });
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('items.product', 'name image slug');
  if (!order) throw ApiError.notFound('Order not found');

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

  // Let the customer know about the moves they care about.
  if (['ready', 'completed', 'cancelled'].includes(status)) {
    emailForOrder(order).then((email) => notifyOrderStatus(order, status, email)).catch(() => {});
  }

  res.json({ success: true, order });
});

const validators = {
  create: [
    body('items').isArray({ min: 1 }).withMessage('Your cart cannot be empty'),
    body('items.*.productId').notEmpty().withMessage('Each item needs a productId'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('orderType').isIn(['dining', 'takeaway', 'delivery']).withMessage('Choose a valid order type'),
    body('paymentMethod').optional().isIn(['online', 'cash']).withMessage('Choose a valid payment method'),
    body('couponCode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 24 }).withMessage('That coupon code isn’t valid'),
  ],
};

module.exports = { createOrder, listMyOrders, getOrder, updateOrderStatus, validators };
