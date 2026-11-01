const { subscriptionPolicy } = require('../saas/plan-policy');
const Bakery = require('../models/Bakery');
const { pickupState } = require('../saas/pickup-state');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Storefront = require('../models/SaasStorefront');
const Product = require('../models/SaasProduct');
const Order = require('../models/SaasOrder');
const { fields, integer } = require('../saas/recipe-input');
const { saleInput, saleHash } = require('../saas/sale-input');
const { customerWrite } = require('../saas/customer-access');
const { recordOrder, orderReady } = require('../saas/record-order');
const { balanceOf } = require('../saas/order-balance');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
function inputOf(body, recording = false) {
  fields(body, ['items', 'comment', ...(recording ? ['confirmed', 'idempotencyKey', 'expectedReservationMinutes'] : [])]);
  if (recording && body.confirmed !== true) throw ApiError.badRequest('Confirm the pickup order');
  const input = saleInput({ items: body.items, comment: body.comment, paymentStatus: 'unpaid', paymentMethod: null, discountPaise: 0, eventId: null, idempotencyKey: recording ? body.idempotencyKey : randomUUID() });
  if (recording && body.expectedReservationMinutes !== undefined) input.expectedReservationMinutes = integer(body.expectedReservationMinutes, 'expectedReservationMinutes', 5, 1440);
  return input;
}
function view(order) {
  return { ...Object.fromEntries(['_id', 'orderNumber', 'version', 'reservationStatus', 'reservationExpiresAt', 'reservationClosedAt', 'reservationConfirmedAt', 'subtotalPaise', 'discountPaise', 'totalPaise', 'paymentStatus', 'paymentMethod', 'createdAt', 'updatedAt'].map(key => [key, order[key]])), items: order.items.map(line => Object.fromEntries(['productId', 'name', 'quantity', 'unitPricePaise', 'lineTotalPaise'].map(key => [key, line[key]]))), ...balanceOf(order), ...pickupState(order), fulfillment: 'pickup' };
}
const quote = asyncHandler(async (req, res) => {
  const input = inputOf(req.body), session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const bakery = await Bakery.findById(req.storeBakery._id).session(session).lean();
      if (!subscriptionPolicy(bakery?.subscription).writable) throw ApiError.conflict('Pickup ordering is paused');
      const settings = await Storefront.findOne({ bakeryId: req.storeBakery._id, published: true, acceptCustomerOrders: true }).session(session).lean();
      if (!settings) throw ApiError.conflict('Pickup ordering is paused');
      const items = []; let totalPaise = 0;
      for (const line of input.items) {
        const product = await Product.findOne({ _id: line.productId, bakeryId: req.storeBakery._id, archived: false, available: true }).session(session).lean();
        if (!product || (product.stockCount !== null && product.stockCount < line.quantity)) throw ApiError.conflict('An item is unavailable. Refresh the menu');
        if (product.pricePaise !== line.expectedUnitPricePaise) throw ApiError.conflict('An item price changed. Refresh and review the menu');
        const lineTotalPaise = product.pricePaise * line.quantity; totalPaise += lineTotalPaise;
        if (!Number.isSafeInteger(totalPaise) || totalPaise > 1000000000000) throw ApiError.badRequest('Order amount exceeds the supported maximum');
        items.push({ productId: String(product._id), name: product.name, quantity: line.quantity, unitPricePaise: product.pricePaise, lineTotalPaise });
      }
      result = { reservationMinutes: settings.pickupReservationMinutes || 30, items, totalPaise, fulfillment: 'pickup', paymentStatus: 'unpaid' };
    }, { readConcern: { level: 'snapshot' } });
  } finally { await session.endSession(); }
  res.json({ success: true, quote: result });
});
const create = asyncHandler(async (req, res) => {
  const input = inputOf(req.body, true), hash = saleHash(input, `customer:${req.customer._id}`); await orderReady();
  const result = await customerWrite(req.customerContext, (session, current) => recordOrder(session, {
    bakeryId: current.bakery._id, actorId: current.customer._id, customerId: current.customer._id, accepting: current.accepting, reservationMinutes: current.reservationMinutes,
  }, input, hash));
  res.status(result.replayed ? 200 : 201).json({ success: true, order: view(result.order), replayed: result.replayed });
});
const list = asyncHandler(async (req, res) => {
  fields(req.query, ['limit', 'cursor']); const { limit = '20', cursor } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)))) throw ApiError.badRequest('Invalid order pagination');
  const orders = await Order.find({ bakeryId: req.storeBakery._id, customerId: req.customer._id, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = orders.length > +limit; if (more) orders.pop(); res.json({ success: true, orders: orders.map(view), nextCursor: more ? String(orders.at(-1)._id) : null });
});
const get = asyncHandler(async (req, res) => {
  fields(req.query, []);
  if (!/^[a-f0-9]{24}$/i.test(req.params.orderId || '')) throw ApiError.notFound('Order not found');
  const order = await Order.findOne({ _id: req.params.orderId, bakeryId: req.storeBakery._id, customerId: req.customer._id }).lean();
  if (!order) throw ApiError.notFound('Order not found'); res.json({ success: true, order: view(order) });
});
module.exports = { quote, create, list, get };
