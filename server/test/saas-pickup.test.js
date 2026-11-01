process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Product = require('../src/models/SaasProduct');
const Order = require('../src/models/SaasOrder');
const Audit = require('../src/models/SaasAuditLog');
const Movement = require('../src/models/SaasStockMovement');
const Membership = require('../src/models/BakeryMembership');
const { signToken } = require('../src/services/token.service');
let database, server, base, token, staffToken, bakery, foreign, cookie, customer, p;
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
const owner = suffix => `/saas/bakeries/${bakery._id}/${suffix}`;
const store = suffix => `/saas/storefront/${bakery.slug}/customer${suffix}`;
async function api(method, path, body, identity = 'owner') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(identity === 'customer' ? { Cookie: cookie, 'X-Saas-Customer': '1', ...(customer ? { 'X-Saas-Customer-Id': customer.id } : {}) } : { Authorization: `Bearer ${identity === 'staff' ? staffToken : token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function place() {
  const response = await api('POST', store('/orders'), { items: [{ productId: p._id, quantity: 2, expectedUnitPricePaise: 1000 }], expectedReservationMinutes: 30, idempotencyKey: randomUUID(), confirmed: true }, 'customer');
  assert.equal(response.status, 201, JSON.stringify(response)); return response.order;
}
const update = (order, status, extra = {}, identity = 'staff') => api('POST', owner(`orders/${order._id}/pickup-status`), { expectedVersion: order.version, confirmed: true, status, ...extra }, identity);
const settle = order => api('POST', owner(`orders/${order._id}/settle`), { expectedVersion: order.version, confirmed: true, paymentMethod: 'cash' });
const past = order => Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(order._id) }, { $set: { reservationExpiresAt: new Date(0) } });
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_pickup_test'));
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; token = signToken(await User.create({ name: 'Pickup owner' }));
  server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  bakery = (await api('POST', '/saas/bakeries', { name: 'Pickup bakery', slug: 'pickup' })).bakery;
  foreign = (await api('POST', '/saas/bakeries', { name: 'Other pickup bakery', slug: 'pickup-foreign' })).bakery;
  await api('PATCH', owner('storefront-settings'), { expectedVersion: 0, published: true, acceptCustomerOrders: true });
  const signup = await api('POST', store('/register'), { email: 'pickup@example.test', displayName: 'Pickup customer', password: 'Local test password!42' }, 'customer'); assert.equal(signup.status, 201); cookie = signup.cookie.split(';')[0]; customer = signup.customer;
  const staff = await User.create({ name: 'Pickup staff' }); staffToken = signToken(staff); await Membership.create({ bakeryId: bakery._id, userId: staff._id, role: 'staff' });
});
beforeEach(async () => {
  await Order.deleteMany({}); await Product.deleteMany({}); await Movement.deleteMany({}); await Audit.deleteMany({});
  p = (await api('POST', owner('products'), { name: 'Pickup cake', slug: 'cake', category: 'Cake', pricePaise: 1000, stockCount: 100 })).product;
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('readiness, payment and collection are independent, versioned and visible to the owning customer', async () => {
  let order = await place(); assert.equal(order.pickupStatus, 'pending'); const deadline = order.reservationExpiresAt;
  assert.equal((await update(order, 'collected')).status, 409);
  const ready = await update(order, 'ready'); assert.equal(ready.status, 200); assert.equal(ready.order.pickupStatus, 'ready'); assert.equal(ready.order.version, 2);
  order = (await api('GET', owner(`orders/${order._id}`))).order;
  assert.equal(order.reservationExpiresAt, deadline); assert.equal(order.paymentStatus, 'unpaid'); assert.equal(order.receivedPaise, 0); assert.equal((await Product.findById(p._id)).stockCount, 98);
  assert.equal((await update(order, 'collected')).status, 409); assert.equal((await settle(order)).status, 200);
  order = (await api('GET', owner(`orders/${order._id}`))).order;
  const collect = await update(order, 'collected'); assert.equal(collect.status, 200); assert.equal(collect.order.pickupStatus, 'collected'); assert.ok(collect.order.pickupCollectedAt);
  const saved = await Order.findById(order._id); assert.equal(saved.version, 4); assert.ok(saved.reservationConfirmedAt); assert.equal(saved.receivedPaise, 2000);
  const own = (await api('GET', store(`/orders/${order._id}`), undefined, 'customer')).order; assert.equal(own.pickupStatus, 'collected'); assert.equal(own.pickupReadyAt, ready.order.pickupReadyAt); assert.equal(own.pickupCollectedAt, collect.order.pickupCollectedAt); assert.equal(own.actorId, undefined); assert.equal(own.costSnapshot, undefined);
  assert.equal(await Movement.countDocuments({ orderId: order._id }), 1); assert.equal(await Audit.countDocuments({ entityId: order._id, action: { $in: ['order.pickupReady', 'order.pickupCollect'] } }), 2);
});
test('concurrent confirmations and late readiness retries never duplicate or regress milestones', async () => {
  const order = await place(); const both = await Promise.all([update(order, 'ready'), update(order, 'ready')]); assert.deepEqual(both.map(r => r.status), [200, 200]); assert.equal(both.filter(r => r.alreadyUpdated).length, 1);
  const ready = (await api('GET', owner(`orders/${order._id}`))).order; await settle(ready); const paid = (await api('GET', owner(`orders/${order._id}`))).order;
  const collected = await Promise.all([update(paid, 'collected'), update(paid, 'collected')]); assert.deepEqual(collected.map(r => r.status), [200, 200]); assert.equal(collected.filter(r => r.alreadyUpdated).length, 1);
  const late = await update(order, 'ready'); assert.equal(late.alreadyUpdated, true); assert.equal(late.order.pickupStatus, 'collected'); assert.equal(late.order.pickupCollectedAt, collected[0].order.pickupCollectedAt);
  assert.equal((await Order.findById(order._id)).version, 4); assert.equal(await Audit.countDocuments({ entityId: order._id, action: 'order.pickupReady' }), 1); assert.equal(await Audit.countDocuments({ entityId: order._id, action: 'order.pickupCollect' }), 1);
});
test('pickup mutations reject foreign orders, customer sessions, counter sales and unexpected input', async () => {
  const order = await place();
  assert.equal((await api('POST', `/saas/bakeries/${foreign._id}/orders/${order._id}/pickup-status`, { status: 'ready', expectedVersion: 1, confirmed: true })).status, 404);
  assert.equal((await api('POST', owner(`orders/${order._id}/pickup-status`), { status: 'ready', expectedVersion: 1, confirmed: true }, 'customer')).status, 401);
  for (const input of [{ confirmed: false }, { status: 'pending' }, { status: 'cancelled' }, { status: 'preparing' }, { paymentStatus: 'paid' }, { pickupReadyAt: new Date().toISOString() }, { expectedVersion: 0 }]) assert.equal((await update(order, 'ready', input)).status, 400);
  assert.equal((await update(order, 'ready', { expectedVersion: 9 })).status, 409);
  const counter = await api('POST', owner('orders'), { items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 1000 }], paymentStatus: 'paid', paymentMethod: 'cash', idempotencyKey: randomUUID() }); assert.equal(counter.status, 201);
  assert.equal(counter.order.pickupStatus, undefined); assert.equal((await update(counter.order, 'ready')).status, 409);
});
test('cancelled and overdue reservations cannot progress, and ready orders still expire without another stock deduction', async () => {
  let order = await place(); await update(order, 'ready'); order = (await api('GET', owner(`orders/${order._id}`))).order;
  await past(order); assert.equal((await update(order, 'collected')).status, 409); assert.equal((await update(order, 'ready')).status, 409);
  const expiry = await api('POST', owner('orders/expire-reservations'), { confirmed: true }); assert.equal(expiry.expiredCount, 1); assert.equal((await Product.findById(p._id)).stockCount, 100);
  assert.equal((await update(order, 'ready')).status, 409); assert.equal(await Movement.countDocuments({ orderId: order._id, kind: 'reservation_return' }), 1);
  const another = await place(); const cancellation = await api('POST', owner(`orders/${another._id}/cancel-pickup`), { confirmed: true, expectedVersion: 1, reason: 'Cancelled' }); assert.equal(cancellation.status, 200); assert.equal((await update(another, 'ready')).status, 409);
});
test('audit failure rolls readiness and collection back without altering payment or stock', async () => {
  let order = await place(); const original = Audit.create; Audit.create = async () => { throw new Error('Synthetic pickup audit failure'); };
  try { assert.equal((await update(order, 'ready')).status, 500); } finally { Audit.create = original; }
  let saved = await Order.findById(order._id); assert.equal(saved.version, 1); assert.equal(saved.pickupStatus, 'pending'); assert.equal(saved.pickupReadyAt, undefined);
  await update(order, 'ready'); order = (await api('GET', owner(`orders/${order._id}`))).order; await settle(order); order = (await api('GET', owner(`orders/${order._id}`))).order;
  Audit.create = async () => { throw new Error('Synthetic collection audit failure'); };
  try { assert.equal((await update(order, 'collected')).status, 500); } finally { Audit.create = original; }
  saved = await Order.findById(order._id); assert.equal(saved.version, 3); assert.equal(saved.pickupStatus, 'ready'); assert.equal(saved.pickupCollectedAt, undefined); assert.equal(saved.receivedPaise, 2000); assert.equal((await Product.findById(p._id)).stockCount, 98);
});
test('payment corrections and collection serialize against the reviewed version', async () => {
  let order = await place(); await update(order, 'ready'); order = (await api('GET', owner(`orders/${order._id}`))).order;
  // First discount one half, receive that invoice, then race a higher invoice
  // against the handover confirmation. Only one reviewed version may win.
  await api('PATCH', owner(`orders/${order._id}/discount`), { expectedVersion: 2, discountPaise: 1000, reason: 'Offer', confirmed: true });
  order = (await api('GET', owner(`orders/${order._id}`))).order; await settle(order); order = (await api('GET', owner(`orders/${order._id}`))).order;
  const results = await Promise.all([update(order, 'collected'), api('PATCH', owner(`orders/${order._id}/discount`), { expectedVersion: order.version, discountPaise: 0, reason: 'Correct offer', confirmed: true })]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = await Order.findById(order._id); assert.equal(saved.pickupStatus === 'collected', saved.totalPaise === 1000); assert.equal(saved.receivedPaise, 1000); assert.equal((await Product.findById(p._id)).stockCount, 98);
});
test('older pickups can progress without a backfill and revoked staff cannot update milestones', async () => {
  const order = await place(); await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(order._id) }, { $unset: { pickupStatus: '' } });
  assert.equal((await api('GET', store(`/orders/${order._id}`), undefined, 'customer')).order.pickupStatus, 'pending');
  assert.equal((await update(order, 'ready')).status, 200);
  const staff = await Membership.findOne({ bakeryId: bakery._id, role: 'staff' }); await Membership.updateOne({ _id: staff._id }, { $set: { active: false } });
  try { assert.equal((await update(order, 'ready')).status, 404); } finally { await Membership.updateOne({ _id: staff._id }, { $set: { active: true } }); }
  assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0); assert.equal(await mongoose.connection.collection('products').countDocuments(), 0);
});
