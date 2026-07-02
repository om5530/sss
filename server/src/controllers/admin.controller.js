const mongoose = require('mongoose');
const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const stripeService = require('../services/stripe.service');
const razorpayService = require('../services/razorpay.service');
const { audit } = require('../services/audit.service');
const { emailForOrder, notifyOrderStatus, notifyRefund } = require('../services/notify.service');

// The store's day runs on IST (AS-8.1); the server may not.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const IST_TZ = 'Asia/Kolkata';

const ACTIVE_STATUSES = ['placed', 'confirmed', 'preparing', 'ready'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertObjectId(id, what = 'Resource') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${what} not found`);
}

/** Start of the current IST calendar day, as a UTC instant. */
function istStartOfToday() {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}

/** Parses ?from=YYYY-MM-DD&to=YYYY-MM-DD as inclusive IST calendar dates. */
function parseRange(query, defaultDays = 30) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  };
  const from = parse(query.from);
  const to = parse(query.to);

  const endExclusive = to
    ? new Date(Date.UTC(to.y, to.mo - 1, to.d + 1) - IST_OFFSET_MS)
    : new Date(istStartOfToday().getTime() + 24 * 60 * 60 * 1000);
  const start = from
    ? new Date(Date.UTC(from.y, from.mo - 1, from.d) - IST_OFFSET_MS)
    : new Date(endExclusive.getTime() - defaultDays * 24 * 60 * 60 * 1000);

  if (start >= endExclusive) throw ApiError.badRequest('"from" must be on or before "to"');
  return { start, endExclusive };
}

function parsePagination(query, defaultLimit = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/* ============ Dashboard (AS-2.1) ============ */

const dashboard = asyncHandler(async (req, res) => {
  const todayStart = istStartOfToday();

  const [todayAgg, activeAgg, typeAgg, unavailable, recentOrders] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: todayStart } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] } },
          paidOrders: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $ne: ['$orderStatus', 'cancelled'] }] },
                1,
                0,
              ],
            },
          },
          revenue: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $ne: ['$orderStatus', 'cancelled'] }] },
                '$pricing.total',
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: { orderStatus: { $in: ACTIVE_STATUSES } } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: todayStart }, orderStatus: { $ne: 'cancelled' } } },
      { $group: { _id: '$orderType', count: { $sum: 1 } } },
    ]),
    Product.find({ available: false, archived: { $ne: true } }).select('name category').limit(12),
    Order.find().sort({ createdAt: -1 }).limit(8).populate('user', 'name phone'),
  ]);

  const today = todayAgg[0] || { orders: 0, cancelled: 0, paidOrders: 0, revenue: 0 };
  const activeByStatus = Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, 0]));
  for (const row of activeAgg) activeByStatus[row._id] = row.count;
  const typeSplit = { dining: 0, takeaway: 0, delivery: 0 };
  for (const row of typeAgg) typeSplit[row._id] = row.count;

  res.json({
    success: true,
    today: {
      orders: today.orders,
      cancelled: today.cancelled,
      revenue: Math.round(today.revenue * 100) / 100,
      avgOrderValue: today.paidOrders ? Math.round((today.revenue / today.paidOrders) * 100) / 100 : 0,
    },
    activeByStatus,
    typeSplit,
    unavailable,
    recentOrders,
  });
});

/* ============ Orders (AS-3.1 / AS-2.2) ============ */

const listOrders = asyncHandler(async (req, res) => {
  const { status, type, payment, q, active } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (active === 'true') filter.orderStatus = { $in: ACTIVE_STATUSES };
  if (status) filter.orderStatus = status;
  if (type) filter.orderType = type;
  if (payment) filter.paymentStatus = payment;
  if (req.query.from || req.query.to) {
    const { start, endExclusive } = parseRange(req.query);
    filter.createdAt = { $gte: start, $lt: endExclusive };
  }

  if (q && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    // Match account holders too, so staff can search by profile name/phone.
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] }).select('_id');
    filter.$or = [
      { orderNumber: rx },
      { 'dining.customerName': rx },
      { 'takeaway.customerName': rx },
      { 'takeaway.phone': rx },
      { user: { $in: users.map((u) => u._id) } },
    ];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name phone email'),
    Order.countDocuments(filter),
  ]);

  res.json({ success: true, orders, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const getOrderAdmin = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Order');
  const order = await Order.findById(req.params.id)
    .populate('user', 'name phone email')
    .populate('items.product', 'name image slug');
  if (!order) throw ApiError.notFound('Order not found');

  const payment = await Payment.findOne({ order: order._id });
  res.json({ success: true, order, payment });
});

/* ============ Cash settlement (B2) ============ */

// Staff record the moment cash changes hands (counter / pickup / delivery).
// This is the only way a cash order becomes "paid".
const settleCashOrder = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Order');
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentMethod !== 'cash') {
    throw ApiError.badRequest('Only cash orders can be settled this way — online orders are confirmed by the payment provider');
  }
  if (order.orderStatus === 'cancelled') throw ApiError.badRequest('This order is cancelled');
  if (order.paymentStatus === 'paid') throw ApiError.conflict('This order is already marked paid');
  if (order.paymentStatus === 'refunded') {
    throw ApiError.conflict('This order was refunded — it cannot be settled again');
  }

  const previousPaymentStatus = order.paymentStatus;
  order.paymentStatus = 'paid';
  if (order.orderStatus === 'placed') {
    order.orderStatus = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', at: new Date(), note: 'Cash received' });
  }
  await order.save();

  const payment = await Payment.findOneAndUpdate(
    { order: order._id },
    {
      order: order._id,
      user: order.user,
      provider: 'cash',
      amount: order.pricing.total,
      currency: order.pricing.currency,
      method: 'cash',
      status: 'succeeded',
      mock: false,
    },
    { upsert: true, new: true },
  );

  audit(req, {
    action: 'payment.cash',
    entity: 'payment',
    entityId: payment._id,
    summary: `Cash received for ${order.orderNumber} (₹${order.pricing.total})`,
    before: { paymentStatus: previousPaymentStatus },
    after: { paymentStatus: 'paid' },
  });

  if (order.orderStatus === 'confirmed') {
    emailForOrder(order).then((email) => notifyOrderStatus(order, 'confirmed', email)).catch(() => {});
  }

  res.json({ success: true, order, payment });
});

/* ============ Refunds (AS-7.2) ============ */

const refundOrder = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Order');
  const reason = (req.body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('A reason is required to issue a refund');

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentStatus === 'refunded') throw ApiError.conflict('This order has already been refunded');
  if (order.paymentStatus !== 'paid') throw ApiError.badRequest('Only paid orders can be refunded');

  const payment = await Payment.findOne({ order: order._id });
  if (!payment) throw ApiError.notFound('No payment record exists for this order');

  // Money moves first; local state only changes once the gateway succeeds.
  // Cash payments have no gateway leg — staff hand the cash back themselves.
  if (payment.provider === 'razorpay') {
    if (!payment.razorpayPaymentId) {
      throw ApiError.badRequest('No captured Razorpay payment exists for this order');
    }
    await razorpayService.createRefund({
      paymentId: payment.razorpayPaymentId,
      isMockPayment: payment.mock,
    });
  } else if (payment.provider !== 'cash') {
    await stripeService.createRefund({
      paymentIntentId: payment.stripePaymentIntentId,
      isMockPayment: payment.mock,
    });
  }

  payment.status = 'refunded';
  await payment.save();
  order.paymentStatus = 'refunded';
  await order.save();

  audit(req, {
    action: 'payment.refund',
    entity: 'payment',
    entityId: payment._id,
    summary: `Refunded ${order.orderNumber} (₹${order.pricing.total}) — ${reason}`,
    before: { paymentStatus: 'paid' },
    after: { paymentStatus: 'refunded', reason },
  });

  emailForOrder(order).then((email) => notifyRefund(order, email)).catch(() => {});

  res.json({ success: true, order, payment });
});

/* ============ Products (AS-4.x) ============ */

const PRODUCT_FIELDS = ['name', 'group', 'category', 'description', 'price', 'image', 'dietary', 'tags', 'available', 'featured', 'stockCount'];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function uniqueSlug(name) {
  const base = slugify(name) || 'product';
  let slug = base;
  for (let n = 2; await Product.exists({ slug }); n += 1) slug = `${base}-${n}`;
  return slug;
}

const listProductsAdmin = asyncHandler(async (req, res) => {
  const { group, category, q, available, featured, archived } = req.query;
  const filter = {};
  // Archived products are hidden unless explicitly requested (AS-4.5).
  if (archived === 'true') filter.archived = true;
  else if (archived !== 'all') filter.archived = { $ne: true };
  if (group) filter.group = group;
  if (category) filter.category = category;
  if (available !== undefined) filter.available = available === 'true';
  if (featured !== undefined) filter.featured = featured === 'true';
  if (q && q.trim()) filter.name = new RegExp(escapeRegex(q.trim()), 'i');

  const products = await Product.find(filter).sort({ group: 1, category: 1, name: 1 });
  res.json({ success: true, count: products.length, products });
});

const getProductAdmin = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Product');
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ success: true, product });
});

const createProduct = asyncHandler(async (req, res) => {
  const data = {};
  for (const f of PRODUCT_FIELDS) if (req.body[f] !== undefined) data[f] = req.body[f];
  data.slug = await uniqueSlug(data.name);

  const product = await Product.create(data);

  audit(req, {
    action: 'product.create',
    entity: 'product',
    entityId: product._id,
    summary: `Created product "${product.name}" (₹${product.price})`,
    after: { name: product.name, price: product.price, category: product.category },
  });

  res.status(201).json({ success: true, product });
});

const updateProduct = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Product');
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  // Optimistic concurrency (AS-10.2): a stale editor is warned, not clobbered.
  if (req.body.ifUnmodifiedSince && product.updatedAt > new Date(req.body.ifUnmodifiedSince)) {
    throw ApiError.conflict('This product was changed by someone else — reload before saving');
  }

  const before = {};
  const after = {};
  for (const f of PRODUCT_FIELDS) {
    if (req.body[f] === undefined) continue;
    const prev = f === 'tags' ? (product[f] || []).join(', ') : product[f];
    const next = f === 'tags' ? (req.body[f] || []).join(', ') : req.body[f];
    if (String(prev) !== String(next)) {
      before[f] = prev;
      after[f] = next;
    }
    product[f] = req.body[f];
  }
  await product.save();

  if (Object.keys(after).length) {
    audit(req, {
      action: 'product.update',
      entity: 'product',
      entityId: product._id,
      summary: `Updated "${product.name}": ${Object.keys(after).join(', ')}`,
      before,
      after,
    });
  }

  res.json({ success: true, product });
});

const archiveProduct = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Product');
  const archived = req.body.archived !== false;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  product.archived = archived;
  if (archived) {
    product.available = false;
    product.featured = false;
  }
  await product.save();

  audit(req, {
    action: archived ? 'product.archive' : 'product.restore',
    entity: 'product',
    entityId: product._id,
    summary: `${archived ? 'Archived' : 'Restored'} product "${product.name}"`,
  });

  res.json({ success: true, product });
});

/* ============ Customers (AS-6.x) ============ */

const listCustomers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const match = {};
  if (q && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    match.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }

  const [customers, total] = await Promise.all([
    User.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'orders',
          localField: '_id',
          foreignField: 'user',
          pipeline: [{ $project: { createdAt: 1, paymentStatus: 1, orderStatus: 1, 'pricing.total': 1 } }],
          as: 'orders',
        },
      },
      {
        $addFields: {
          orderCount: { $size: '$orders' },
          lastOrderAt: { $max: '$orders.createdAt' },
          totalSpent: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$orders',
                    cond: {
                      $and: [{ $eq: ['$$this.paymentStatus', 'paid'] }, { $ne: ['$$this.orderStatus', 'cancelled'] }],
                    },
                  },
                },
                in: '$$this.pricing.total',
              },
            },
          },
        },
      },
      { $project: { name: 1, phone: 1, email: 1, role: 1, createdAt: 1, orderCount: 1, lastOrderAt: 1, totalSpent: 1 } },
    ]),
    User.countDocuments(match),
  ]);

  res.json({ success: true, customers, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const getCustomer = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'Customer');
  const customer = await User.findById(req.params.id).select('-googleId -firebaseUid');
  if (!customer) throw ApiError.notFound('Customer not found');

  const orders = await Order.find({ user: customer._id }).sort({ createdAt: -1 });
  const totalSpent = orders
    .filter((o) => o.paymentStatus === 'paid' && o.orderStatus !== 'cancelled')
    .reduce((sum, o) => sum + o.pricing.total, 0);

  res.json({ success: true, customer, orders, totalSpent: Math.round(totalSpent * 100) / 100 });
});

/* ============ Payments (AS-7.1) ============ */

const listPayments = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (status) filter.status = status;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('order', 'orderNumber orderType orderStatus paymentStatus pricing createdAt')
      .populate('user', 'name phone'),
    Payment.countDocuments(filter),
  ]);

  res.json({ success: true, payments, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/* ============ Reports (AS-8.x) ============ */

const PAID_MATCH = { paymentStatus: 'paid', orderStatus: { $ne: 'cancelled' } };

const salesReport = asyncHandler(async (req, res) => {
  const { start, endExclusive } = parseRange(req.query);
  const granularity = ['day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
  const format = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' }[granularity];
  const range = { createdAt: { $gte: start, $lt: endExclusive } };

  const [buckets, excludedAgg] = await Promise.all([
    Order.aggregate([
      { $match: { ...range, ...PAID_MATCH } },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format, timezone: IST_TZ } },
          revenue: { $sum: '$pricing.total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: range },
      {
        $group: {
          _id: null,
          cancelled: { $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] } },
          refundedAmount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, '$pricing.total', 0] } },
          refundedCount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const rows = buckets.map((b) => ({
    period: b._id,
    revenue: Math.round(b.revenue * 100) / 100,
    orders: b.orders,
    avgOrderValue: Math.round((b.revenue / b.orders) * 100) / 100,
  }));
  const revenue = Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100;
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const excluded = excludedAgg[0] || { cancelled: 0, refundedAmount: 0, refundedCount: 0 };

  res.json({
    success: true,
    granularity,
    from: start,
    to: endExclusive,
    rows,
    totals: {
      revenue,
      orders,
      avgOrderValue: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
      cancelled: excluded.cancelled,
      refundedCount: excluded.refundedCount,
      refundedAmount: Math.round(excluded.refundedAmount * 100) / 100,
    },
  });
});

const productReport = asyncHandler(async (req, res) => {
  const { start, endExclusive } = parseRange(req.query);
  const match = { createdAt: { $gte: start, $lt: endExclusive }, ...PAID_MATCH };

  const [topProducts, byCategory, byType] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $last: '$items.name' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { category: 1, archived: 1 } }],
          as: 'product',
        },
      },
      {
        $project: {
          name: 1,
          quantity: 1,
          revenue: { $round: ['$revenue', 2] },
          category: { $ifNull: [{ $first: '$product.category' }, '—'] },
          archived: { $ifNull: [{ $first: '$product.archived' }, false] },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          pipeline: [{ $project: { category: 1 } }],
          as: 'product',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $first: '$product.category' }, '—'] },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
      { $project: { category: '$_id', quantity: 1, revenue: { $round: ['$revenue', 2] }, _id: 0 } },
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: '$orderType', orders: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
      { $project: { type: '$_id', orders: 1, revenue: { $round: ['$revenue', 2] }, _id: 0 } },
    ]),
  ]);

  res.json({ success: true, from: start, to: endExclusive, topProducts, byCategory, byType });
});

/* ============ Audit log (AS-1.3) ============ */

const listAudit = asyncHandler(async (req, res) => {
  const { entity, action } = req.query;
  const { page, limit, skip } = parsePagination(req.query, 30);

  const filter = {};
  if (entity) filter.entity = entity;
  if (action) filter.action = action;

  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ success: true, entries, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/* ============ Validators ============ */

const productRules = (onCreate) => [
  body('name').if((v, { req }) => onCreate || req.body.name !== undefined).trim().notEmpty().withMessage('Name is required'),
  body('group').if((v, { req }) => onCreate || req.body.group !== undefined).isIn(['bakery', 'savoury']).withMessage('Group must be bakery or savoury'),
  body('category').if((v, { req }) => onCreate || req.body.category !== undefined).trim().notEmpty().withMessage('Category is required'),
  body('price').if((v, { req }) => onCreate || req.body.price !== undefined).isFloat({ min: 0 }).withMessage('Price must be 0 or more'),
  body('dietary').optional().isIn(['veg', 'non-veg', 'egg']).withMessage('Choose a valid dietary tag'),
  body('description').optional().isString(),
  body('image').optional().isString(),
  body('tags').optional().isArray().withMessage('Tags must be a list'),
  body('available').optional().isBoolean(),
  body('featured').optional().isBoolean(),
  // null = stop tracking stock; otherwise a non-negative whole number.
  body('stockCount')
    .optional({ values: 'null' })
    .custom((v) => v === null || (Number.isInteger(v) && v >= 0))
    .withMessage('Stock must be a whole number of 0 or more (leave blank to stop tracking)'),
];

const validators = {
  createProduct: productRules(true),
  updateProduct: productRules(false),
  refund: [body('reason').trim().notEmpty().withMessage('A reason is required to issue a refund')],
};

module.exports = {
  dashboard,
  listOrders,
  getOrderAdmin,
  settleCashOrder,
  refundOrder,
  listProductsAdmin,
  getProductAdmin,
  createProduct,
  updateProduct,
  archiveProduct,
  listCustomers,
  getCustomer,
  listPayments,
  salesReport,
  productReport,
  listAudit,
  validators,
};
