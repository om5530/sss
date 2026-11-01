const Order = require('../models/SaasOrder');
const { fields, integer, text } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const { customerWrite } = require('../saas/customer-access');
const { reservationReady, closeReservation, expireDue } = require('../saas/reservations');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
function inputOf(req) {
  fields(req.body, ['expectedVersion', 'confirmed', 'reason']);
  if (!/^[a-f0-9]{24}$/i.test(req.params.orderId || '')) throw ApiError.notFound('Order not found');
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm the pickup cancellation');
  return { expectedVersion: integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER), reason: text(req.body.reason, 'reason', 500) };
}
const summary = (result, owner) => ({ success: true, alreadyClosed: result.alreadyClosed, order: {
  _id: result.order._id, version: result.order.version, reservationStatus: result.order.reservationStatus,
  reservationClosedAt: result.order.reservationClosedAt, ...(owner ? { reservationReturns: result.order.reservationReturns } : {}),
} });
const cancelCustomer = asyncHandler(async (req, res) => {
  const input = inputOf(req); await reservationReady();
  const result = await customerWrite(req.customerContext, async (session, current) => {
    const order = await Order.findOne({ _id: req.params.orderId, bakeryId: current.bakery._id, customerId: current.customer._id }).session(session);
    if (!order) throw ApiError.notFound('Order not found');
    return closeReservation(session, { bakeryId: current.bakery._id, actorId: current.customer._id, actorType: 'customer' }, order, input);
  });
  res.json(summary(result, false));
});
const cancelOwner = asyncHandler(async (req, res) => {
  const input = inputOf(req); await reservationReady();
  const result = await ownerWrite(req.bakeryContext, async session => {
    const order = await Order.findOne({ _id: req.params.orderId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!order) throw ApiError.notFound('Order not found');
    return closeReservation(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id }, order, input);
  }, { recovery: true });
  res.json(summary(result, true));
});
const refreshCustomer = asyncHandler(async (req, res) => {
  fields(req.body, []); await reservationReady();
  const result = await customerWrite(req.customerContext, (session, current) => expireDue(session, { bakeryId: current.bakery._id, actorId: current.customer._id, actorType: 'customer' }));
  // Do not disclose other customers' IDs, stock-return exceptions or reasons.
  res.json({ success: true, availabilityChanged: result.expiredCount > 0, hasMore: result.hasMore });
});
const refreshOwner = asyncHandler(async (req, res) => {
  fields(req.body, ['confirmed']); if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm release of expired pickup reservations'); await reservationReady();
  const result = await ownerWrite(req.bakeryContext, session => expireDue(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id }), { recovery: true });
  res.json({ success: true, ...result });
});
module.exports = { cancelCustomer, cancelOwner, refreshCustomer, refreshOwner };
