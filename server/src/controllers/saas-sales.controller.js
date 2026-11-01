const { actorKey } = require('../saas/account-access');
const { pickupState } = require('../saas/pickup-state');
const { assertPayable } = require('../saas/reservations');
const { recordOrder } = require('../saas/record-order');
const { stockReady } = require('../saas/stock-movement');
const { requireCapacity } = require('../saas/usage-limits');
const Waste = require('../models/SaasWaste');
const mongoose = require('mongoose');
const Event = require('../models/SaasEvent');
const Order = require('../models/SaasOrder');
const Payment = require('../models/SaasPaymentEntry');
const { balanceOf, ensureBalance, entry } = require('../saas/order-balance');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { Decimal } = require('../services/bakeryCost.service');
const { ownerWrite, memberWrite } = require('../saas/owner-write');
const { fields, text, integer } = require('../saas/recipe-input');
const { auditReady, recordAudit } = require('../saas/audit');
const { saleInput, saleHash, METHODS } = require('../saas/sale-input');
const idPattern = /^[a-f0-9]{24}$/i;
function id(value, label) { if (typeof value !== 'string' || !idPattern.test(value)) throw ApiError.notFound(`${label} not found`); return value; }
function view(order, owner = false) {
  return { ...Object.fromEntries(['_id', 'eventId', 'orderNumber', 'items', 'subtotalPaise', 'discountPaise', 'totalPaise', 'paymentStatus', 'paymentMethod', 'comment', 'version', 'createdAt', 'updatedAt'].map(key => [key, order[key]])), ...balanceOf(order), ...pickupState(order), ...(order.source === 'storefront' ? { reservationStatus: order.reservationStatus || 'active', reservationExpiresAt: order.reservationExpiresAt || null, ...(owner ? { reservationReturns: order.reservationReturns || [] } : {}), reservationClosedAt: order.reservationClosedAt || null, reservationConfirmedAt: order.reservationConfirmedAt || null } : {}), source: order.source || 'counter', ...(order.fulfillment ? { fulfillment: order.fulfillment } : {}) };
}
function eventView(event, owner) {
  return Object.fromEntries(['_id', 'name', 'key', 'status', 'version', ...(owner ? ['rentPaise', 'travelPaise', 'extraPaise'] : [])].map(key => [key, event[key]]));
}
async function ready() { await Promise.all([Event.init(), Order.init(), Payment.init(), stockReady(), auditReady()]); }
async function audit(req, session, action, record, before, changedFields) {
  await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action,
    entityId: record._id, fromVersion: before, toVersion: record.version, fields: changedFields });
}
function pagination(query, extra = []) {
  fields(query, ['limit', 'cursor', ...extra]);
  const { limit = '20', cursor } = query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !idPattern.test(cursor)))) throw ApiError.badRequest('Invalid pagination');
  return { limit: +limit, cursor };
}
const listEvents = asyncHandler(async (req, res) => {
  const { limit, cursor } = pagination(req.query);
  const events = await Event.find({ bakeryId: req.bakeryContext.bakeryId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = events.length > limit; if (more) events.pop();
  res.json({ success: true, events: events.map(row => eventView(row, req.bakeryContext.role === 'owner')), nextCursor: more ? String(events.at(-1)._id) : null });
});
const createEvent = asyncHandler(async (req, res) => {
  fields(req.body, ['name', 'key', 'rentPaise', 'travelPaise', 'extraPaise']);
  const name = text(req.body.name, 'event name', 120), key = text(req.body.key, 'event key', 120).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw ApiError.badRequest('Invalid event key');
  const data = { name, key };
  for (const field of ['rentPaise', 'travelPaise', 'extraPaise']) data[field] = req.body[field] === undefined ? 0 : integer(req.body[field], field, 0, 1000000000000);
  await ready(); let event;
  try {
    event = await ownerWrite(req.bakeryContext, async session => {
      await requireCapacity(Event, req.bakeryContext.bakeryId, 'events', session);
      const [created] = await Event.create([{ bakeryId: req.bakeryContext.bakeryId, ...data }], { session });
      await audit(req, session, 'event.create', created, 0, Object.keys(data)); return created;
    });
  } catch (error) { if (error.code === 11000) throw ApiError.conflict('This event key is already used in this bakery'); throw error; }
  res.status(201).json({ success: true, event: eventView(event, true) });
});
const closeEvent = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed']);
  const eventId = id(req.params.eventId, 'Event'), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm event closure'); await ready();
  const event = await ownerWrite(req.bakeryContext, async session => {
    const current = await Event.findOne({ _id: eventId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Event not found');
    if (current.version !== expected) throw ApiError.conflict('Event changed. Reload before closing');
    if (current.status === 'closed') return current;
    current.status = 'closed'; current.version++; await current.save({ session });
    await audit(req, session, 'event.close', current, expected, ['status']); return current;
  }, { recovery: true });
  res.json({ success: true, event: eventView(event, true) });
});
const listOrders = asyncHandler(async (req, res) => {
  const { limit, cursor } = pagination(req.query, ['eventId', 'paymentStatus']);
  const filter = { bakeryId: req.bakeryContext.bakeryId };
  if (req.query.eventId !== undefined) filter.eventId = id(req.query.eventId, 'Event');
  if (req.query.paymentStatus !== undefined) {
    if (!['paid', 'unpaid'].includes(req.query.paymentStatus)) throw ApiError.badRequest('Invalid payment status');
    filter.paymentStatus = req.query.paymentStatus;
  }
  if (cursor) filter._id = { $lt: cursor };
  const orders = await Order.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = orders.length > limit; if (more) orders.pop();
  res.json({ success: true, orders: orders.map(order => view(order, req.bakeryContext.role === 'owner')), nextCursor: more ? String(orders.at(-1)._id) : null });
});
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: id(req.params.orderId, 'Order'), bakeryId: req.bakeryContext.bakeryId }).lean();
  if (!order) throw ApiError.notFound('Order not found'); res.json({ success: true, order: view(order, req.bakeryContext.role === 'owner') });
});
const createOrder = asyncHandler(async (req, res) => {
  const input = saleInput(req.body), requestHash = saleHash(input, actorKey({ userId: req.user._id, identityType: req.identityType })); await ready();
  const result = await memberWrite(req.bakeryContext, session => recordOrder(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id }, input, requestHash));
  res.status(result.replayed ? 200 : 201).json({ success: true, order: view(result.order, req.bakeryContext.role === 'owner'), replayed: result.replayed });
});
const settleOrder = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed', 'paymentMethod']);
  const orderId = id(req.params.orderId, 'Order'), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  if (req.body.confirmed !== true || !METHODS.includes(req.body.paymentMethod)) throw ApiError.badRequest('Confirm the received manual payment method'); await ready();
  const order = await memberWrite(req.bakeryContext, async session => {
    const current = await Order.findOne({ _id: orderId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Order not found');
    assertPayable(current);
    if (current.version !== expected) throw ApiError.conflict('Order changed. Reload before confirming payment');
    if (current.paymentStatus === 'paid') {
      if (current.paymentMethod !== req.body.paymentMethod) throw ApiError.conflict('Payment is already recorded with another method');
      return current;
    }
    await ensureBalance(session, current, req.user._id);
    const duePaise = balanceOf(current).duePaise;
    await entry(session, current, req.user._id, { kind: 'receipt', amountPaise: duePaise, paymentMethod: req.body.paymentMethod,
      operationKey: `receipt:${current.version}`, reason: '' });
    current.receivedPaise += duePaise;
    if (current.source === 'storefront' && !current.reservationConfirmedAt) current.reservationConfirmedAt = new Date();
    current.paymentStatus = 'paid'; current.paymentMethod = req.body.paymentMethod; current.version++; await current.save({ session });
    await audit(req, session, 'order.settle', current, expected, ['paymentStatus', 'paymentMethod']); return current;
  }, { recovery: true });
  res.json({ success: true, order: view(order, req.bakeryContext.role === 'owner') });
});
const eventReport = asyncHandler(async (req, res) => {
  const eventId = id(req.params.eventId, 'Event'), bakeryId = req.bakeryContext.bakeryId;
  fields(req.query, []);
  const session = await mongoose.startSession(); let report;
  try {
    await session.withTransaction(async () => {
      const event = await Event.findOne({ _id: eventId, bakeryId }).session(session).lean();
      if (!event) throw ApiError.notFound('Event not found');
      let paidOrders = 0, unpaidOrders = 0, paidUnits = 0, unknownCostLines = 0;
      let sales = new Decimal(0), costs = new Decimal(0), outstanding = new Decimal(0), received = new Decimal(0), refunds = new Decimal(0);
      const cursor = Order.find({ bakeryId, eventId }).select('+costSnapshot').session(session).lean().cursor();
      try {
        for await (const order of cursor) {
          const balance = balanceOf(order);
          received = received.add(balance.receivedPaise); outstanding = outstanding.add(balance.duePaise); refunds = refunds.add(balance.refundDuePaise);
          if (order.paymentStatus !== 'paid') { unpaidOrders++; continue; }
          paidOrders++; sales = sales.add(order.totalPaise);
          const snapshots = new Map((order.costSnapshot || []).map(row => [String(row.productId), row]));
          for (const line of order.items) {
            paidUnits += line.quantity;
            const snapshot = snapshots.get(String(line.productId)), cost = snapshot?.unitCostPaise;
            if (cost === null || cost === undefined) unknownCostLines++;
            else costs = costs.add(snapshot.batchCostPaise != null && snapshot.yieldPieces > 0
              ? new Decimal(snapshot.batchCostPaise).mul(line.quantity).div(snapshot.yieldPieces)
              : new Decimal(cost).mul(line.quantity));
          }
        }
      } finally { await cursor.close(); }
      let recordedWasteUnits = 0, unknownWasteLines = 0, wasteCost = new Decimal(0);
      const groupedWaste = new Map();
      const wasteCursor = Waste.find({ bakeryId, eventId }).session(session).lean().cursor();
      try {
        for await (const row of wasteCursor) {
          recordedWasteUnits += row.quantity;
          if (row.batchCostPaise == null || !row.yieldPieces) { unknownWasteLines++; continue; }
          const key = `${row.revisionId}:${row.batchCostPaise}:${row.yieldPieces}`, previous = groupedWaste.get(key);
          groupedWaste.set(key, { batchCost: row.batchCostPaise, yield: row.yieldPieces, quantity: (previous?.quantity || new Decimal(0)).add(row.quantity) });
        }
      } finally { await wasteCursor.close(); }
      for (const row of groupedWaste.values()) wasteCost = wasteCost.add(new Decimal(row.batchCost).mul(row.quantity).div(row.yield));
      const expenses = new Decimal(event.rentPaise).add(event.travelPaise).add(event.extraPaise);
      report = { event: eventView(event, true), paidOrders, unpaidOrders, paidUnits, unknownCostLines,
        recordedWasteUnits, unknownWasteLines, knownWasteCostPaise: wasteCost.toString(),
        paidSalesPaise: sales.toString(), receivedMoneyPaise: received.toString(), refundDuePaise: refunds.toString(), knownSoldCostPaise: costs.toString(), outstandingPaise: outstanding.toString(),
        expensesPaise: expenses.toString(), recordedProfitPaise: unknownCostLines || unknownWasteLines ? null : sales.sub(costs).sub(expenses).sub(wasteCost).toString(),
        includesProductionWaste: false };
    }, { readConcern: { level: 'snapshot' } });
  } finally { await session.endSession(); }
  res.json({ success: true, report });
});
module.exports = { listEvents, createEvent, closeEvent, listOrders, getOrder, createOrder, settleOrder, eventReport };
