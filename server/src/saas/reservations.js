const Order = require('../models/SaasOrder');
const Product = require('../models/SaasProduct');
const { receivedOf } = require('./order-balance');
const { recordMovement, stockReady } = require('./stock-movement');
const { auditReady, recordAudit } = require('./audit');
const ApiError = require('../utils/ApiError');
const CLOSED = ['cancelled', 'expired'];
function isClosed(order) { return CLOSED.includes(order.reservationStatus); }
function isDue(order, now = new Date()) { return order.source === 'storefront' && order.pickupStatus !== 'collected' && !order.reservationConfirmedAt && !isClosed(order) && order.paymentStatus === 'unpaid' && receivedOf(order) === 0 && order.reservationExpiresAt && new Date(order.reservationExpiresAt) <= now; }
function assertPayable(order) {
  if (isClosed(order)) throw ApiError.conflict('This pickup reservation is closed');
  if (isDue(order)) throw ApiError.conflict('This pickup reservation expired. Refresh reservations before recording payment or corrections');
}
async function reservationReady() { await Promise.all([Order.init(), Product.init(), stockReady(), auditReady()]); }
async function closeReservation(session, context, order, { expectedVersion, reason, expired = false, now = new Date() }) {
  if (order.source !== 'storefront' || order.fulfillment !== 'pickup') throw ApiError.conflict('Only customer pickup reservations can be closed here');
  // Terminal records are the idempotency boundary: retry never restores stock
  // again, overwrites a reason, or changes cancelled into expired (or vice versa).
  if (isClosed(order)) return { order, alreadyClosed: true };
  if (order.version !== expectedVersion) throw ApiError.conflict('Order changed. Reload before cancelling');
  if (order.pickupStatus === 'collected' || order.reservationConfirmedAt || order.paymentStatus !== 'unpaid' || receivedOf(order) !== 0) throw ApiError.conflict('Orders with confirmed or partial payment cannot be cancelled here');
  const due = !!isDue(order, now);
  if (expired && !due) throw ApiError.conflict('This reservation is not due for expiry');
  const returns = [];
  for (const line of order.items) {
    const result = { productId: line.productId, quantity: line.quantity, status: 'not_claimed' };
    if (line.stockClaimed) {
      const product = await Product.findOne({ _id: line.productId, bakeryId: context.bakeryId }).session(session);
      if (!product) result.status = 'product_missing';
      else if (product.stockCount === null) result.status = 'untracked';
      else if (!Number.isSafeInteger(line.stockEpoch)) result.status = 'unversioned';
      else if ((product.stockEpoch || 1) !== line.stockEpoch) result.status = 'count_changed';
      else if (product.stockCount + line.quantity > 1000000) result.status = 'overflow';
      else {
        const before = product.stockCount; product.stockCount += line.quantity; product.version++; await product.save({ session });
        await recordMovement(session, { bakeryId: context.bakeryId, userId: context.actorId, actorType: context.actorType || 'staff' }, {
          productId: product._id, orderId: order._id, kind: 'reservation_return', before, after: product.stockCount, productVersion: product.version,
        });
        result.status = 'restored';
      }
    }
    returns.push(result);
  }
  const before = order.version;
  order.reservationStatus = due ? 'expired' : 'cancelled'; order.reservationClosedAt = now;
  order.reservationCloseReason = due ? 'Pickup reservation expired' : reason; order.reservationReturns = returns; order.version++;
  await order.save({ session });
  await recordAudit(session, { bakeryId: context.bakeryId, actorId: context.actorId, actorType: context.actorType || 'staff',
    action: due ? 'reservation.expire' : 'reservation.cancel', entityId: order._id, fromVersion: before, toVersion: order.version,
    fields: ['reservationStatus', 'reservationReturns', 'reservationClosedAt'] });
  return { order, alreadyClosed: false };
}
async function expireDue(session, context, limit = 20, now = new Date()) {
  // Every caller first holds the bakery write lock. Neither customer input nor
  // an order ID can expand this sweep beyond the server's due/unpaid policy.
  const rows = await Order.find({ bakeryId: context.bakeryId, source: 'storefront', fulfillment: 'pickup', paymentStatus: 'unpaid',
    receivedPaise: 0, pickupStatus: { $ne: 'collected' }, reservationConfirmedAt: null, reservationStatus: 'active', reservationExpiresAt: { $lte: now } }).sort({ reservationExpiresAt: 1, _id: 1 }).limit(limit + 1).session(session);
  const hasMore = rows.length > limit; if (hasMore) rows.pop(); let reconciliationCount = 0;
  for (const order of rows) {
    const result = await closeReservation(session, context, order, { expectedVersion: order.version, expired: true, now });
    if (result.order.reservationReturns.some(line => !['restored', 'not_claimed'].includes(line.status))) reconciliationCount++;
  }
  return { expiredCount: rows.length, reconciliationCount, hasMore };
}
module.exports = { isClosed, isDue, assertPayable, reservationReady, closeReservation, expireDue };
