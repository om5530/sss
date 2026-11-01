const Order = require('../models/SaasOrder');
const { fields, integer } = require('../saas/recipe-input');
const { memberWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const { assertPayable } = require('../saas/reservations');
const { balanceOf } = require('../saas/order-balance');
const { pickupState } = require('../saas/pickup-state');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const RANK = { pending: 0, ready: 1, collected: 2 };
const update = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed', 'status']);
  if (!/^[a-f0-9]{24}$/i.test(req.params.orderId || '')) throw ApiError.notFound('Order not found');
  const expectedVersion = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER), target = req.body.status;
  if (req.body.confirmed !== true || !['ready', 'collected'].includes(target)) throw ApiError.badRequest('Confirm a pickup readiness or collection update');
  await Promise.all([Order.init(), auditReady()]);
  const result = await memberWrite(req.bakeryContext, async session => {
    const order = await Order.findOne({ _id: req.params.orderId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!order) throw ApiError.notFound('Order not found');
    if (order.source !== 'storefront' || order.fulfillment !== 'pickup') throw ApiError.conflict('Only customer pickup orders have collection tracking');
    assertPayable(order);
    const state = order.pickupStatus || 'pending';
    // Monotonic milestones are their own retry boundary. A late ready retry
    // must not move a collected order backwards or rewrite timestamps/audits.
    if (RANK[state] >= RANK[target]) return { order, alreadyUpdated: true };
    if (order.version !== expectedVersion) throw ApiError.conflict('Order changed. Reload before updating pickup status');
    if (target === 'collected') {
      if (state !== 'ready') throw ApiError.conflict('Mark the order ready before confirming collection');
      if (order.paymentStatus !== 'paid' || balanceOf(order).duePaise !== 0) throw ApiError.conflict('Record full payment before confirming collection');
    }
    const now = new Date(), before = order.version;
    order.pickupStatus = target;
    if (target === 'ready') order.pickupReadyAt = now;
    else { order.pickupCollectedAt = now; order.reservationConfirmedAt ||= now; }
    order.version++; await order.save({ session });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: target === 'ready' ? 'order.pickupReady' : 'order.pickupCollect', entityId: order._id,
      fromVersion: before, toVersion: order.version, fields: ['pickupStatus', target === 'ready' ? 'pickupReadyAt' : 'pickupCollectedAt'] });
    return { order, alreadyUpdated: false };
  }, { recovery: true });
  res.json({ success: true, alreadyUpdated: result.alreadyUpdated, order: { _id: result.order._id, version: result.order.version, ...pickupState(result.order) } });
});
module.exports = { update };
