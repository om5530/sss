const { Decimal } = require('../services/bakeryCost.service');
const Payment = require('../models/SaasPaymentEntry');
const ApiError = require('../utils/ApiError');
function receivedOf(order) {
  return order.receivedPaise === undefined ? (order.paymentStatus === 'paid' ? order.totalPaise : 0) : order.receivedPaise;
}
function balanceOf(order) {
  const receivedPaise = receivedOf(order);
  if (['cancelled', 'expired'].includes(order.reservationStatus)) return { receivedPaise, duePaise: 0, refundDuePaise: 0 };
  return { receivedPaise, duePaise: Math.max(0, order.totalPaise - receivedPaise), refundDuePaise: Math.max(0, receivedPaise - order.totalPaise) };
}
async function entry(session, order, actorId, data) {
  const [created] = await Payment.create([{ bakeryId: order.bakeryId, orderId: order._id, actorId, ...data }], { session });
  return created;
}
async function ensureBalance(session, order, actorId) {
  if (order.receivedPaise !== undefined) return;
  // Older development orders had only an implicit paid/unpaid balance. Preserve
  // it explicitly on mutation; never modify any legacy collection or recost it.
  const cursor = Payment.find({ bakeryId: order.bakeryId, orderId: order._id }).session(session).lean().cursor();
  let count = 0, received = new Decimal(0);
  try { for await (const row of cursor) { count++; received = row.kind === 'refund' ? received.sub(row.amountPaise) : received.add(row.amountPaise); } }
  finally { await cursor.close(); }
  if (!count) {
    received = new Decimal(receivedOf(order));
    await entry(session, order, actorId, { kind: 'baseline', amountPaise: received.toNumber(), paymentMethod: order.paymentMethod || null,
      operationKey: 'baseline', reason: 'Inferred balance from an earlier development order' });
  }
  if (!received.isInteger() || received.lt(0) || received.gt('1000000000000')) throw ApiError.conflict('The payment ledger requires review before changing this order');
  order.receivedPaise = received.toNumber();
}
module.exports = { receivedOf, balanceOf, entry, ensureBalance };
