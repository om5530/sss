const { actorKey } = require('../saas/account-access');
const { assertPayable } = require('../saas/reservations');
const Order = require('../models/SaasOrder');
const Payment = require('../models/SaasPaymentEntry');
const Change = require('../models/SaasOrderChange');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { fields, integer, text } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const { balanceOf, ensureBalance, entry } = require('../saas/order-balance');
const { sourceChecksum } = require('../saas/migration-manifest');
const { METHODS } = require('../saas/sale-input');
const orderId = req => { if (!/^[a-f0-9]{24}$/i.test(req.params.orderId || '')) throw ApiError.notFound('Order not found'); return req.params.orderId; };
const view = order => ({ _id: order._id, discountPaise: order.discountPaise, totalPaise: order.totalPaise, paymentStatus: order.paymentStatus, version: order.version, ...balanceOf(order) });
async function ready() { await Promise.all([Payment.init(), Change.init(), auditReady()]); }
const discount = asyncHandler(async (req, res) => {
  fields(req.body, ['discountPaise', 'comment', 'reason', 'expectedVersion', 'confirmed']);
  const id = orderId(req), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  const discountPaise = integer(req.body.discountPaise, 'discountPaise', 0, 1000000000000), reason = text(req.body.reason, 'reason', 500);
  const comment = req.body.comment === undefined ? undefined : text(req.body.comment, 'comment', 1000, true);
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm the order correction'); await ready();
  const order = await ownerWrite(req.bakeryContext, async session => {
    const current = await Order.findOne({ _id: id, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Order not found');
    assertPayable(current);
    if (current.version !== expected) throw ApiError.conflict('Order changed. Reload before correcting it');
    if (discountPaise > current.subtotalPaise) throw ApiError.badRequest('Discount exceeds the order subtotal');
    await ensureBalance(session, current, req.user._id);
    if (current.source === 'storefront' && !current.reservationConfirmedAt && (current.paymentStatus === 'paid' || current.receivedPaise > 0)) current.reservationConfirmedAt = new Date();
    const before = { discountPaise: current.discountPaise, totalPaise: current.totalPaise };
    current.discountPaise = discountPaise; current.totalPaise = current.subtotalPaise - discountPaise;
    current.paymentStatus = current.receivedPaise >= current.totalPaise ? 'paid' : 'unpaid';
    if (current.source === 'storefront' && current.paymentStatus === 'paid' && !current.reservationConfirmedAt) current.reservationConfirmedAt = new Date();
    if (comment !== undefined) current.comment = comment;
    current.version++; await current.save({ session });
    await Change.create([{ bakeryId: req.bakeryContext.bakeryId, orderId: current._id, actorId: req.user._id,
      fromVersion: expected, toVersion: current.version, beforeDiscountPaise: before.discountPaise, afterDiscountPaise: discountPaise,
      beforeTotalPaise: before.totalPaise, afterTotalPaise: current.totalPaise, reason }], { session });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'order.discount', entityId: current._id,
      fromVersion: expected, toVersion: current.version, fields: ['discountPaise', ...(comment === undefined ? [] : ['comment'])] });
    return current;
  }, { recovery: true });
  res.json({ success: true, order: view(order) });
});
const refund = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed', 'paymentMethod', 'expectedRefundPaise', 'reason', 'idempotencyKey']);
  const id = orderId(req), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  const amount = integer(req.body.expectedRefundPaise, 'expectedRefundPaise', 1, 1000000000000), reason = text(req.body.reason, 'reason', 500);
  if (req.body.confirmed !== true || !METHODS.includes(req.body.paymentMethod)) throw ApiError.badRequest('Confirm the manually returned payment and method');
  if (typeof req.body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 refund submission key is required');
  const operationKey = `refund:${req.body.idempotencyKey.toLowerCase()}`;
  const requestHash = sourceChecksum({ orderId: id.toLowerCase(), actorId: actorKey({ userId: req.user._id, identityType: req.identityType }), expectedVersion: expected, amountPaise: amount, reason, paymentMethod: req.body.paymentMethod });
  await ready();
  const result = await ownerWrite(req.bakeryContext, async session => {
    const current = await Order.findOne({ _id: id, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Order not found');
    assertPayable(current);
    const previous = await Payment.findOne({ bakeryId: req.bakeryContext.bakeryId, orderId: current._id, operationKey }).select('+requestHash').session(session);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ApiError(409, 'This refund key was already used for different details', { code: 'PAYMENT_KEY_CONFLICT' });
      return { order: current, replayed: true };
    }
    // Only after this transaction proved the key has no saved refund may a
    // definitive rejection let the client discard its pending retry record.
    try {
      if (current.version !== expected) throw ApiError.conflict('Order changed. Reload before recording a refund');
      await ensureBalance(session, current, req.user._id);
      if (balanceOf(current).refundDuePaise !== amount) throw ApiError.conflict('The refundable balance changed. Review it before recording a refund');
      await entry(session, current, req.user._id, { kind: 'refund', amountPaise: amount, paymentMethod: req.body.paymentMethod, operationKey, requestHash, reason });
      current.receivedPaise -= amount; current.version++; await current.save({ session });
      await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'order.refund', entityId: current._id,
        fromVersion: expected, toVersion: current.version, fields: ['receivedPaise'] });
      return { order: current, replayed: false };
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) error.details = { code: 'REFUND_REJECTED' };
      throw error;
    }
  }, { recovery: true });
  res.json({ success: true, order: view(result.order), replayed: result.replayed });
});
const history = asyncHandler(async (req, res) => {
  fields(req.query, ['limit', 'cursor']);
  if (!['payments', 'changes'].includes(req.params.kind)) throw ApiError.notFound('History not found');
  const { limit = '50', cursor } = req.query, id = orderId(req);
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)))) throw ApiError.badRequest('Invalid history pagination');
  if (!await Order.exists({ _id: id, bakeryId: req.bakeryContext.bakeryId })) throw ApiError.notFound('Order not found');
  const filter = { bakeryId: req.bakeryContext.bakeryId, orderId: id, ...(cursor ? { _id: { $lt: cursor } } : {}) };
  const Model = req.params.kind === 'payments' ? Payment : Change;
  const rows = await Model.find(filter).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = rows.length > +limit; if (more) rows.pop();
  res.json({ success: true, entries: rows.map(row => {
    const keys = Model === Payment ? ['_id', 'kind', 'amountPaise', 'paymentMethod', 'reason', 'createdAt']
      : ['_id', 'fromVersion', 'toVersion', 'beforeDiscountPaise', 'afterDiscountPaise', 'beforeTotalPaise', 'afterTotalPaise', 'reason', 'createdAt'];
    return Object.fromEntries(keys.map(key => [key, row[key]]));
  }), nextCursor: more ? String(rows.at(-1)._id) : null });
});
module.exports = { discount, refund, history };
