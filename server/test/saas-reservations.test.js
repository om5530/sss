process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Product = require('../src/models/SaasProduct');
const Order = require('../src/models/SaasOrder');
const Audit = require('../src/models/SaasAuditLog');
const Movement = require('../src/models/SaasStockMovement');
const Session = require('../src/models/SaasCustomerSession');
const { signToken } = require('../src/services/token.service');
const { customerWrite } = require('../src/saas/customer-access');
const { saleInput, saleHash } = require('../src/saas/sale-input');
const { recordOrder, orderReady } = require('../src/saas/record-order');
let database, server, base, token, bakery, other, account, cookie, context, serial = 0;
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
const ownerPath = suffix => `/saas/bakeries/${bakery._id}/${suffix}`;
const customerPath = suffix => `/saas/storefront/${bakery.slug}/customer${suffix}`;
async function api(method, path, body, customer = false) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(customer ? { Cookie: cookie, 'X-Saas-Customer': '1', ...(account ? { 'X-Saas-Customer-Id': account.id } : {}) } : { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function product(stockCount = 20) { const result = await api('POST', ownerPath('products'), { name: 'Pickup cake', slug: `pickup-${++serial}`, category: 'Cake', pricePaise: 1000, stockCount }); assert.equal(result.status, 201); return result.product; }
async function place(p, extra = {}) {
  const input = saleInput({ items: [{ productId: String(p._id), quantity: 2, expectedUnitPricePaise: 1000 }], paymentStatus: 'unpaid', idempotencyKey: randomUUID(), ...extra });
  input.expectedReservationMinutes = 30; await orderReady();
  return (await customerWrite(context, (session, current) => recordOrder(session, { bakeryId: bakery._id, actorId: account.id, customerId: account.id, accepting: current.accepting, reservationMinutes: current.reservationMinutes }, input, saleHash(input, `customer:${account.id}`)))).order;
}
const cancelInput = (order, extra = {}) => ({ confirmed: true, expectedVersion: order.version, reason: 'Customer changed plans', ...extra });
const cancel = (order, extra) => api('POST', ownerPath(`orders/${order._id}/cancel-pickup`), cancelInput(order, extra));
const settle = order => api('POST', ownerPath(`orders/${order._id}/settle`), { confirmed: true, expectedVersion: order.version, paymentMethod: 'cash' });
const past = order => Order.collection.updateOne({ _id: order._id }, { $set: { reservationExpiresAt: new Date(0) } });
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] });
  await mongoose.connect(database.getUri('saas_reservations_test')); process.env.SAAS_FOUNDATION_ENABLED = 'true';
  token = signToken(await User.create({ name: 'Reservation owner' })); server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  bakery = (await api('POST', '/saas/bakeries', { name: 'Reservation bakery', slug: 'reservations' })).bakery;
  other = (await api('POST', '/saas/bakeries', { name: 'Other bakery', slug: 'other-reservations' })).bakery;
  assert.equal((await api('PATCH', ownerPath('storefront-settings'), { expectedVersion: 0, published: true, acceptCustomerOrders: true })).status, 200);
  const signup = await api('POST', customerPath('/register'), { email: 'pickup@example.test', displayName: 'Pickup customer', password: 'Local test password!42' }, true); assert.equal(signup.status, 201);
  cookie = signup.cookie.split(';')[0]; account = signup.customer;
  const session = await Session.findOne({ bakeryId: bakery._id, customerId: account.id }).lean(); context = { bakeryId: bakery._id, customerId: account.id, sessionId: session._id, sessionVersion: session.sessionVersion };
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('customer cancellation is scoped, versioned, confirmed, atomic and safely repeatable', async () => {
  const p = await product(), order = await place(p); assert.equal(order.reservationStatus, 'active'); assert.ok(order.reservationExpiresAt > new Date());
  assert.equal((await cancel(order, { confirmed: false })).status, 400); assert.equal((await cancel(order, { expectedVersion: 99 })).status, 409);
  const results = await Promise.all([api('POST', customerPath(`/orders/${order._id}/cancel`), cancelInput(order), true), api('POST', customerPath(`/orders/${order._id}/cancel`), cancelInput(order), true)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(results.filter(r => r.alreadyClosed).length, 1); assert.equal(results[0].order.reservationReturns, undefined);
  assert.equal((await Product.findById(p._id)).stockCount, 20); assert.equal(await Movement.countDocuments({ orderId: order._id, kind: 'reservation_return' }), 1);
  const audit = await Audit.findOne({ entityId: order._id, action: 'reservation.cancel' }); assert.equal(audit.actorType, 'customer');
  const own = await api('GET', customerPath(`/orders/${order._id}`), undefined, true); assert.equal(own.order.duePaise, 0); assert.equal(own.order.refundDuePaise, 0); assert.equal(own.order.reservationStatus, 'cancelled');
  assert.equal((await api('POST', `/saas/bakeries/${other._id}/orders/${order._id}/cancel-pickup`, cancelInput(order))).status, 404);
  assert.equal((await settle(order)).status, 409);
  assert.equal((await api('PATCH', ownerPath(`orders/${order._id}/discount`), { expectedVersion: 2, discountPaise: 100, reason: 'Closed', confirmed: true })).status, 409);
  assert.equal((await api('POST', ownerPath(`orders/${order._id}/refund`), { expectedVersion: 2, expectedRefundPaise: 1, paymentMethod: 'cash', reason: 'Closed', confirmed: true, idempotencyKey: randomUUID() })).status, 409);
});
test('payment and cancellation serialize without returning paid stock', async () => {
  const p = await product(), order = await place(p); const results = await Promise.all([settle(order), cancel(order)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const stored = await Order.findById(order._id); assert.equal((await Product.findById(p._id)).stockCount, stored.reservationStatus === 'cancelled' ? 20 : 18);
  if (stored.paymentStatus === 'paid') assert.equal((await cancel(stored)).status, 409);
});
test('stock recounts quarantine returns; unchanged stock submitted with a price edit remains safe', async () => {
  for (const kind of ['price', 'count', 'explicit', 'untracked', 'missing', 'unversioned', 'overflow']) {
    const p = await product(), order = await place(p), current = await Product.findById(p._id);
    if (kind === 'price') assert.equal((await api('PATCH', ownerPath(`products/${p._id}`), { expectedVersion: current.version, stockCount: 18, name: 'Renamed cake' })).status, 200);
    if (kind === 'count' || kind === 'explicit') assert.equal((await api('PATCH', ownerPath(`products/${p._id}`), { expectedVersion: current.version, stockCount: kind === 'count' ? 5 : 18, ...(kind === 'explicit' ? { stockCountConfirmed: true } : {}) })).status, 200);
    if (kind === 'untracked') await Product.updateOne({ _id: p._id }, { $set: { stockCount: null } });
    if (kind === 'missing') await Product.deleteOne({ _id: p._id });
    if (kind === 'unversioned') await Order.collection.updateOne({ _id: order._id }, { $unset: { 'items.0.stockEpoch': '' } });
    if (kind === 'overflow') await Product.updateOne({ _id: p._id }, { $set: { stockCount: 1000000 } });
    const result = await cancel(order); assert.equal(result.status, 200, JSON.stringify(result));
    const expected = { price: 'restored', count: 'count_changed', explicit: 'count_changed', untracked: 'untracked', missing: 'product_missing', unversioned: 'unversioned', overflow: 'overflow' }[kind];
    assert.equal(result.order.reservationReturns[0].status, expected);
    if (kind === 'price') assert.equal((await Product.findById(p._id)).stockCount, 20);
    if (kind === 'count') assert.equal((await Product.findById(p._id)).stockCount, 5);
    if (kind === 'explicit') assert.equal((await Product.findById(p._id)).stockCount, 18);
    if (kind === 'overflow') assert.equal((await Product.findById(p._id)).stockCount, 1000000);
  }
});
test('a failed audit rolls cancellation and stock return back together', async () => {
  const p = await product(), order = await place(p), original = Audit.create;
  Audit.create = async () => { throw new Error('Synthetic cancellation audit failure'); };
  try { assert.equal((await cancel(order)).status, 500); } finally { Audit.create = original; }
  assert.equal((await Order.findById(order._id)).reservationStatus, 'active'); assert.equal((await Product.findById(p._id)).stockCount, 18);
  assert.equal(await Movement.countDocuments({ orderId: order._id, kind: 'reservation_return' }), 0); assert.equal((await cancel(order)).status, 200);
});
test('expired reservations cannot be settled and request-driven expiry is bounded and tenant scoped', async () => {
  const p = await product(100), order = await place(p); await past(order); assert.equal((await settle(order)).status, 409);
  const original = await Order.findById(order._id).select('+idempotencyKey +requestHash +customerId +costSnapshot').lean();
  const records = Array.from({ length: 20 }, (_, i) => ({ ...original, _id: new mongoose.Types.ObjectId(), idempotencyKey: randomUUID(), sequence: 1000 + i, orderNumber: `BOUND-${i}` }));
  await Order.collection.insertMany(records); await Product.updateOne({ _id: p._id }, { $set: { stockCount: 58 } });
  const foreign = { ...original, _id: new mongoose.Types.ObjectId(), bakeryId: new mongoose.Types.ObjectId(other._id), idempotencyKey: randomUUID() }; await Order.collection.insertOne(foreign);
  const refresh = await api('POST', customerPath('/reservations/refresh'), {}, true); assert.equal(refresh.status, 200); assert.equal(refresh.availabilityChanged, true); assert.equal(refresh.hasMore, true);
  assert.deepEqual(Object.keys(refresh).filter(k => !['status', 'cookie'].includes(k)).sort(), ['availabilityChanged', 'hasMore', 'success']);
  assert.equal(await Order.countDocuments({ bakeryId: bakery._id, reservationStatus: 'expired' }), 20); assert.equal((await Product.findById(p._id)).stockCount, 98);
  const finish = await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true }); assert.equal(finish.expiredCount, 1); assert.equal(finish.hasMore, false); assert.equal((await Product.findById(p._id)).stockCount, 100);
  assert.equal((await Order.findById(foreign._id)).reservationStatus, 'active');
  assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).expiredCount, 0);
});
test('expiry ignores legacy, partial-payment and ever-confirmed reservations', async () => {
  const p = await product(), order = await place(p);
  await Order.collection.updateOne({ _id: order._id }, { $unset: { reservationExpiresAt: '', reservationStatus: '' } });
  assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).expiredCount, 0); assert.equal((await cancel(order)).status, 200);
  const confirmed = await place(p);
  const correction = (discountPaise, expectedVersion) => api('PATCH', ownerPath(`orders/${confirmed._id}/discount`), { discountPaise, expectedVersion, reason: 'Comp correction', confirmed: true });
  assert.equal((await correction(2000, 1)).status, 200); assert.equal((await correction(0, 2)).status, 200);
  await past(confirmed); const stored = await Order.findById(confirmed._id); assert.equal(stored.paymentStatus, 'unpaid'); assert.equal(stored.receivedPaise, 0); assert.ok(stored.reservationConfirmedAt);
  assert.equal((await cancel(stored)).status, 409); assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).expiredCount, 0);
  await Order.updateOne({ _id: confirmed._id }, { $set: { paymentStatus: 'paid' } });
  const partial = await place(p); await Order.updateOne({ _id: partial._id }, { $set: { receivedPaise: 1 } }); await past(partial);
  assert.equal((await cancel(partial)).status, 409); assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).expiredCount, 0);
  await Order.updateOne({ _id: partial._id }, { $set: { paymentStatus: 'paid' } });
});
test('future reservations, other customer identities, staff and counter orders cannot be released by this flow', async () => {
  const p = await product(), order = await place(p);
  assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).expiredCount, 0);
  const savedCookie = cookie, savedAccount = account, savedToken = token;
  const signup = await api('POST', customerPath('/register'), { email: 'another@example.test', displayName: 'Another customer', password: 'Local test password!42' }, true);
  assert.equal(signup.status, 201);
  try {
    cookie = signup.cookie.split(';')[0]; account = signup.customer;
    assert.equal((await api('POST', customerPath(`/orders/${order._id}/cancel`), cancelInput(order), true)).status, 404);
    const staff = await User.create({ name: 'Reservation staff' });
    await require('../src/models/BakeryMembership').create({ bakeryId: bakery._id, userId: staff._id, role: 'staff' }); token = signToken(staff);
    assert.equal((await cancel(order)).status, 403);
    assert.equal((await api('POST', ownerPath('orders/expire-reservations'), { confirmed: true })).status, 403);
    const view = await api('GET', ownerPath(`orders/${order._id}`)); assert.equal(view.status, 200); assert.equal(view.order.reservationReturns, undefined);
  } finally { cookie = savedCookie; account = savedAccount; token = savedToken; }
  assert.equal((await cancel(order)).status, 200);
  const counter = await api('POST', ownerPath('orders'), { items: [{ productId: String(p._id), quantity: 1, expectedUnitPricePaise: 1000 }], paymentStatus: 'unpaid', idempotencyKey: randomUUID() }); assert.equal(counter.status, 201);
  assert.equal((await cancel(counter.order)).status, 409);
  assert.equal((await Product.findById(p._id)).stockCount, 19);
});
test('reviewed expiry terms are required for new orders but older saved retries remain valid', async () => {
  const p = await product(), request = { items: [{ productId: String(p._id), quantity: 1, expectedUnitPricePaise: 1000 }], comment: '', confirmed: true, idempotencyKey: randomUUID() };
  let result = await api('POST', customerPath('/orders'), request, true); assert.equal(result.status, 409); assert.equal(result.details.code, 'SALE_REJECTED');
  result = await api('POST', customerPath('/orders'), { ...request, expectedReservationMinutes: 30 }, true); assert.equal(result.status, 201);
  const { confirmed: ignored, ...legacy } = request; const normalized = saleInput({ ...legacy, paymentStatus: 'unpaid' });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(result.order._id) }, { $set: { requestHash: saleHash(normalized, `customer:${account.id}`) } });
  assert.equal((await api('POST', customerPath('/orders'), request, true)).replayed, true);
  assert.equal((await api('PATCH', ownerPath('storefront-settings'), { expectedVersion: 1, pickupReservationMinutes: 45 })).status, 200);
  result = await api('POST', customerPath('/orders'), { ...request, idempotencyKey: randomUUID(), expectedReservationMinutes: 30 }, true); assert.equal(result.status, 409); assert.equal(result.details.code, 'SALE_REJECTED');
  assert.equal((await cancel(await Order.findOne({ idempotencyKey: request.idempotencyKey }))).status, 200);
  assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0); assert.equal(await mongoose.connection.collection('products').countDocuments(), 0);
});
