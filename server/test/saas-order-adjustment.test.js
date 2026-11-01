process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Membership = require('../src/models/BakeryMembership');
const Order = require('../src/models/SaasOrder');
const Product = require('../src/models/SaasProduct');
const Payment = require('../src/models/SaasPaymentEntry');
const Change = require('../src/models/SaasOrderChange');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, token, staffToken, otherToken, bakery, other, product;
const path = suffix => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
async function sale(extra = {}) {
  const response = await api('POST', path('orders'), { items: [{ productId: product._id, quantity: 1, expectedUnitPricePaise: 10000 }], paymentStatus: 'paid', paymentMethod: 'cash', idempotencyKey: randomUUID(), ...extra });
  assert.equal(response.status, 201, JSON.stringify(response)); return response.order;
}
const correct = (order, discountPaise, extra = {}) => api('PATCH', path(`orders/${order._id}/discount`), { expectedVersion: order.version, discountPaise, reason: 'Synthetic correction', confirmed: true, ...extra });
const refundBody = (order, amount = order.refundDuePaise) => ({ expectedVersion: order.version, expectedRefundPaise: amount, reason: 'Manually returned overpayment', paymentMethod: 'upi', confirmed: true, idempotencyKey: randomUUID() });
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] } });
  await mongoose.connect(database.getUri('saas_adjustments_test'));
  const [owner, employee, stranger] = await User.create([{ name: 'Correction owner' }, { name: 'Counter employee' }, { name: 'Other owner' }]);
  token = signToken(owner); staffToken = signToken(employee); otherToken = signToken(stranger);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  bakery = (await api('POST', '/saas/bakeries', { name: 'Corrections bakery', slug: 'corrections' })).bakery;
  other = (await api('POST', '/saas/bakeries', { name: 'Other bakery', slug: 'other-corrections' }, otherToken)).bakery;
  await Membership.create({ bakeryId: bakery._id, userId: employee._id, role: 'staff' });
  product = (await api('POST', path('products'), { name: 'Synthetic cake', slug: 'cake', category: 'Cakes', pricePaise: 10000, stockCount: 100 })).product;
});
after(async () => {
  if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop();
});
test('discount corrections preserve receipts, items, stock and private cost snapshots', async () => {
  const order = await sale(); assert.equal(order.receivedPaise, 10000); assert.equal(order.duePaise, 0);
  const before = await Order.findById(order._id).select('+costSnapshot').lean(), stock = (await Product.findById(product._id)).stockCount;
  const result = await correct(order, 3000, { comment: 'Corrected discount' });
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.order.totalPaise, 7000); assert.equal(result.order.receivedPaise, 10000);
  assert.equal(result.order.refundDuePaise, 3000); assert.equal(result.order.paymentStatus, 'paid'); assert.equal(result.order.version, 2);
  const after = await Order.findById(order._id).select('+costSnapshot').lean();
  assert.deepEqual(after.items, before.items); assert.deepEqual(after.costSnapshot, before.costSnapshot); assert.equal(after.subtotalPaise, before.subtotalPaise);
  assert.equal((await Product.findById(product._id)).stockCount, stock); assert.equal(await Payment.countDocuments({ orderId: order._id }), 1);
  const history = await api('GET', path(`orders/${order._id}/history/changes`)); assert.equal(history.entries[0].beforeTotalPaise, 10000); assert.equal(history.entries[0].afterTotalPaise, 7000);
  assert.equal(history.entries[0].reason, 'Synthetic correction'); assert.equal(history.entries[0].actorId, undefined);
});
test('reducing a discount collects only the remaining balance under simultaneous settlement', async () => {
  const order = await sale({ discountPaise: 4000 }); assert.equal(order.receivedPaise, 6000);
  const corrected = await correct(order, 1000); assert.equal(corrected.status, 200); assert.equal(corrected.order.duePaise, 3000); assert.equal(corrected.order.paymentStatus, 'unpaid');
  const uri = path(`orders/${order._id}/settle`), request = { expectedVersion: 2, confirmed: true, paymentMethod: 'upi' };
  const results = await Promise.all([api('POST', uri, request, staffToken), api('POST', uri, request, staffToken)]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const receipts = await Payment.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(receipts.map(row => row.amountPaise), [6000, 3000]);
  const latest = (await api('GET', path(`orders/${order._id}`))).order;
  assert.equal(latest.receivedPaise, 9000); assert.equal(latest.duePaise, 0); assert.equal(latest.paymentMethod, 'upi');
});
test('manual refunds require a reviewed exact balance and replay safely under concurrency', async () => {
  const order = await sale(); const changed = (await correct(order, 2500)).order;
  const uri = path(`orders/${order._id}/refund`), request = refundBody(changed);
  assert.equal((await api('POST', uri, { ...request, confirmed: false })).status, 400);
  const rejected = await api('POST', uri, { ...request, expectedRefundPaise: 2400 });
  assert.equal(rejected.status, 409); assert.equal(rejected.details.code, 'REFUND_REJECTED');
  const results = await Promise.all([api('POST', uri, request), api('POST', uri, request)]);
  assert.deepEqual(results.map(row => row.status), [200, 200]); assert.equal(results.filter(row => row.replayed).length, 1);
  assert.equal(results[0].order.receivedPaise, 7500); assert.equal(results[0].order.refundDuePaise, 0);
  assert.equal(await Payment.countDocuments({ orderId: order._id, kind: 'refund' }), 1);
  const mismatch = await api('POST', uri, { ...request, reason: 'Different request' }); assert.equal(mismatch.status, 409); assert.equal(mismatch.details.code, 'PAYMENT_KEY_CONFLICT');
  assert.equal((await api('POST', uri, { ...request, expectedVersion: 3, idempotencyKey: randomUUID() })).status, 409);
  const history = await api('GET', path(`orders/${order._id}/history/payments`) + '?limit=1');
  assert.equal(history.entries.length, 1); assert.ok(history.nextCursor);
  for (const key of ['operationKey', 'requestHash', 'actorId', 'bakeryId', 'orderId']) assert.equal(history.entries[0][key], undefined);
});
test('owner role, bakery scope, optimistic versions and strict correction validation are enforced', async () => {
  const order = await sale(), changed = (await correct(order, 2000)).order;
  for (const [method, suffix, body] of [['PATCH', 'discount', { expectedVersion: 2, discountPaise: 3000, reason: 'Test', confirmed: true }], ['POST', 'refund', refundBody(changed)]]) {
    assert.equal((await api(method, path(`orders/${order._id}/${suffix}`), body, staffToken)).status, 403);
    assert.equal((await api(method, `/saas/bakeries/${other._id}/orders/${order._id}/${suffix}`, body, otherToken)).status, 404);
  }
  for (const kind of ['payments', 'changes']) {
    assert.equal((await api('GET', path(`orders/${order._id}/history/${kind}`), undefined, staffToken)).status, 403);
    assert.equal((await api('GET', `/saas/bakeries/${other._id}/orders/${order._id}/history/${kind}`, undefined, otherToken)).status, 404);
  }
  for (const extra of [{ confirmed: false }, { discountPaise: 10001 }, { totalPaise: 0 }, { reason: '' }]) assert.equal((await correct(changed, 2000, extra)).status, 400);
  assert.equal((await correct(changed, 2000, { expectedVersion: 1 })).status, 409);
  assert.equal((await api('GET', path(`orders/${order._id}/history/payments`) + '?limit=101')).status, 400);
});
test('audit failures roll back corrections and refunds with their ledger entries', async () => {
  const order = await sale(); const original = Audit.create;
  Audit.create = async () => { throw new Error('Synthetic adjustment audit failure'); };
  try { assert.equal((await correct(order, 2000)).status, 500); } finally { Audit.create = original; }
  assert.equal((await Order.findById(order._id)).version, 1); assert.equal(await Change.countDocuments({ orderId: order._id }), 0);
  const changed = (await correct(order, 2000)).order;
  Audit.create = async () => { throw new Error('Synthetic refund audit failure'); };
  try { assert.equal((await api('POST', path(`orders/${order._id}/refund`), refundBody(changed))).status, 500); } finally { Audit.create = original; }
  assert.equal((await Order.findById(order._id)).receivedPaise, 10000); assert.equal(await Payment.countDocuments({ orderId: order._id, kind: 'refund' }), 0);
});
test('older development orders get an explicitly inferred baseline only on first mutation', async () => {
  const order = await sale(); await Payment.deleteMany({ orderId: order._id }); await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(order._id) }, { $unset: { receivedPaise: '' } });
  const result = await correct(order, 1000); assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.order.receivedPaise, 10000);
  const baseline = await Payment.findOne({ orderId: order._id }).lean(); assert.equal(baseline.kind, 'baseline'); assert.match(baseline.reason, /Inferred/);
  assert.equal((await correct(result.order, 2000)).status, 200); assert.equal(await Payment.countDocuments({ orderId: order._id }), 1);
});
test('event reports separate paid invoices, received money, remaining dues and refunds owed', async () => {
  const event = (await api('POST', path('events'), { name: 'Balance report', key: 'balance-report' })).event;
  const overpaid = await sale({ eventId: event._id }); await correct(overpaid, 3000);
  const underpaid = await sale({ eventId: event._id, discountPaise: 5000 }); await correct(underpaid, 1000);
  const result = await api('GET', path(`events/${event._id}/report`)); assert.equal(result.status, 200);
  assert.equal(result.report.paidSalesPaise, '7000'); assert.equal(result.report.receivedMoneyPaise, '15000'); assert.equal(result.report.outstandingPaise, '4000'); assert.equal(result.report.refundDuePaise, '3000');
  assert.equal(result.report.recordedProfitPaise, null); assert.equal(result.report.unknownCostLines, 1);
  assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0);
});
