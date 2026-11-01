process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Membership = require('../src/models/BakeryMembership');
const Bakery = require('../src/models/Bakery');
const Product = require('../src/models/SaasProduct');
const Order = require('../src/models/SaasOrder');
const Audit = require('../src/models/SaasAuditLog');
const Movement = require('../src/models/SaasStockMovement');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, token, otherToken, staffToken, staff, a, b, p, q, material, recipe, eventA, eventB, freeOrder, unpaidOrder, freeBody, latestRevisionId;
const path = (bakery, suffix) => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const result = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', ...(credentials ? { Authorization: `Bearer ${credentials}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: result.status, ...await result.json() };
}
const body = overrides => ({ eventId: eventA._id, items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 19900 }], paymentStatus: 'paid', paymentMethod: 'cash', idempotencyKey: randomUUID(), ...overrides });
before(async () => {
  // This suite exclusively uses its own temporary loopback database URI.
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] } });
  await mongoose.connect(database.getUri('saas_sales_test'));
  const [owner, other, employee] = await User.create([{ name: 'Sales owner A' }, { name: 'Sales owner B' }, { name: 'Counter staff' }]);
  token = signToken(owner); otherToken = signToken(other); staff = employee; staffToken = signToken(staff);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await api('POST', '/saas/bakeries', { name: 'Bakery A', slug: 'sales-a' })).bakery;
  b = (await api('POST', '/saas/bakeries', { name: 'Bakery B', slug: 'sales-b' }, otherToken)).bakery;
  await Membership.create({ bakeryId: a._id, userId: staff._id, role: 'staff' });
  p = (await api('POST', path(a, 'products'), { name: 'Biscoff', slug: 'biscoff', category: 'Cakes', pricePaise: 19900, stockCount: 10 })).product;
  q = (await api('POST', path(b, 'products'), { name: 'Biscoff', slug: 'biscoff', category: 'Cakes', pricePaise: 29900, stockCount: 5 }, otherToken)).product;
  material = (await api('POST', path(a, 'materials'), { name: 'Demo batch', packQuantity: '8', packUom: 'piece', purchasePricePaise: 80000 })).material;
  recipe = await api('POST', path(a, 'recipes'), { name: 'Biscoff', category: 'Cakes', yieldPieces: 8, ingredients: [{ materialId: material._id, expectedVersion: 1, quantity: '8', uom: 'piece' }] });
  const mapped = await api('PATCH', path(a, `products/${p._id}/recipe-mapping`), { revisionId: recipe.revision._id, expectedVersion: p.version });
  assert.equal(mapped.status, 200); p.version = mapped.product.version;
});
after(async () => {
  if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop();
});

test('event keys are tenant-local and private event expenses are never returned to staff', async () => {
  const first = await api('POST', path(a, 'events'), { name: 'Demo event', key: 'demo-event', rentPaise: 10000 });
  assert.equal(first.status, 201); eventA = first.event;
  const second = await api('POST', path(b, 'events'), { name: 'Demo event B', key: 'demo-event', rentPaise: 50000 }, otherToken);
  assert.equal(second.status, 201); eventB = second.event;
  assert.equal((await api('POST', path(a, 'events'), { name: 'Duplicate', key: 'demo-event' })).status, 409);
  assert.equal((await api('POST', path(a, 'events'), { name: 'Staff', key: 'staff' }, staffToken)).status, 403);
  const visible = await api('GET', path(a, 'events'), undefined, staffToken);
  assert.equal(visible.events.length, 1); assert.equal(visible.events[0].rentPaise, undefined);
  assert.equal((await api('GET', path(a, `events/${eventA._id}/report`), undefined, staffToken)).status, 403);
  assert.equal((await api('GET', path(a, 'events'), undefined, otherToken)).status, 404);
});

test('staff sales use authoritative prices, snapshot recipe costs privately and replay safely', async () => {
  freeBody = body({ discountPaise: 19900, comment: 'Complimentary demo' });
  const created = await api('POST', path(a, 'orders'), freeBody, staffToken);
  assert.equal(created.status, 201, JSON.stringify(created)); freeOrder = created.order;
  assert.equal(freeOrder.totalPaise, 0); assert.equal(freeOrder.subtotalPaise, 19900); assert.equal(freeOrder.orderNumber, 'ORD-000001');
  for (const field of ['costSnapshot', 'requestHash', 'actorId', 'idempotencyKey']) assert.equal(freeOrder[field], undefined);
  assert.equal((await Product.findById(p._id)).stockCount, 9);
  const history = await api('GET', path(a, `products/${p._id}/stock-history`));
  assert.equal(history.status, 200); assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].kind, 'sale'); assert.equal(history.entries[0].before, 10); assert.equal(history.entries[0].after, 9);
  assert.equal(history.entries[0].delta, -1); assert.equal(history.entries[0].orderId, freeOrder._id); assert.equal(history.entries[0].actorId, undefined);
  assert.equal((await api('GET', path(a, `products/${p._id}/stock-history`), undefined, staffToken)).status, 403);
  assert.equal((await api('GET', path(b, `products/${p._id}/stock-history`), undefined, otherToken)).status, 404);
  const stored = await Order.findById(freeOrder._id).select('+costSnapshot').lean();
  assert.equal(stored.costSnapshot[0].unitCostPaise, '10000'); assert.equal(String(stored.costSnapshot[0].revisionId), recipe.revision._id);
  const serialized = (await Order.findById(freeOrder._id).select('+costSnapshot +requestHash +idempotencyKey')).toJSON();
  for (const field of ['costSnapshot', 'requestHash', 'idempotencyKey', 'actorId']) assert.equal(serialized[field], undefined);
  const replay = await api('POST', path(a, 'orders'), freeBody, staffToken);
  assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.order._id, freeOrder._id);
  assert.equal((await Product.findById(p._id)).stockCount, 9);
  assert.equal(await Movement.countDocuments({ bakeryId: a._id, productId: p._id }), 2);
  assert.equal((await api('POST', path(a, 'orders'), { ...freeBody, discountPaise: 0 }, staffToken)).status, 409);
  assert.equal((await api('POST', path(a, 'orders'), freeBody)).status, 409);
  const report = (await api('GET', path(a, `events/${eventA._id}/report`))).report;
  assert.equal(report.paidSalesPaise, '0'); assert.equal(report.knownSoldCostPaise, '10000'); assert.equal(report.recordedProfitPaise, '-20000');
});

test('foreign references and client price/cost overrides cannot create sales or consume stock', async () => {
  const stock = (await Product.findById(p._id)).stockCount;
  for (const payload of [body({ items: [{ productId: q._id, quantity: 1, expectedUnitPricePaise: 29900 }] }), body({ eventId: eventB._id })]) {
    assert.equal((await api('POST', path(a, 'orders'), payload, staffToken)).status, 404);
  }
  for (const payload of [body({ totalPaise: 0 }), body({ items: [{ productId: p._id, quantity: 1, unitPricePaise: 0 }] }),
    body({ discountPaise: 19901 }), body({ paymentMethod: 'online' }), body({ items: [{ productId: p._id, quantity: 0 }] }),
    body({ items: [{ productId: p._id, quantity: 1 }, { productId: p._id, quantity: 1 }] }), body({ idempotencyKey: 'retry' })]) {
    assert.equal((await api('POST', path(a, 'orders'), payload)).status, 400, JSON.stringify(payload));
  }
  assert.equal((await Product.findById(p._id)).stockCount, stock);
  const stale = await api('POST', path(a, 'orders'), body({ items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 1 }] }));
  assert.equal(stale.status, 409); assert.equal(stale.details.code, 'SALE_REJECTED');
  assert.equal((await Product.findById(p._id)).stockCount, stock);
  assert.equal((await api('GET', path(b, `orders/${freeOrder._id}`), undefined, otherToken)).status, 404);
  assert.equal((await api('GET', path(a, `orders/${freeOrder._id}`), undefined, null)).status, 401);
  assert.equal((await api('GET', path(b, 'orders'), undefined, otherToken)).orders.length, 0);
});

test('unpaid sales are settled with explicit confirmation and reports retain original saved costs', async () => {
  const created = await api('POST', path(a, 'orders'), body({ paymentStatus: 'unpaid', paymentMethod: null }), staffToken);
  assert.equal(created.status, 201); unpaidOrder = created.order;
  let report = (await api('GET', path(a, `events/${eventA._id}/report`))).report;
  assert.equal(report.unpaidOrders, 1); assert.equal(report.outstandingPaise, '19900'); assert.equal(report.paidSalesPaise, '0');
  const uri = path(a, `orders/${unpaidOrder._id}/settle`);
  assert.equal((await api('POST', uri, { expectedVersion: 1, paymentMethod: 'upi' }, staffToken)).status, 400);
  const settled = await api('POST', uri, { expectedVersion: 1, paymentMethod: 'upi', confirmed: true }, staffToken);
  assert.equal(settled.status, 200, JSON.stringify(settled)); assert.equal(settled.order.version, 2);
  assert.equal((await api('POST', uri, { expectedVersion: 1, paymentMethod: 'upi', confirmed: true }, staffToken)).status, 409);
  report = (await api('GET', path(a, `events/${eventA._id}/report`))).report;
  assert.equal(report.paidOrders, 2); assert.equal(report.paidUnits, 2); assert.equal(report.paidSalesPaise, '19900');
  assert.equal(report.knownSoldCostPaise, '20000'); assert.equal(report.recordedProfitPaise, '-10100');
  const snapshot = (await Order.findById(unpaidOrder._id).select('+costSnapshot').lean()).costSnapshot;
  await api('PATCH', path(a, `materials/${material._id}`), { expectedVersion: 1, purchasePricePaise: 160000 });
  const newRevision = await api('POST', path(a, `recipes/${recipe.recipe._id}/revisions`), { expectedVersion: 1, yieldPieces: 9,
    ingredients: [{ materialId: material._id, expectedVersion: 2, quantity: '8', uom: 'piece' }] });
  assert.equal(newRevision.status, 201);
  latestRevisionId = newRevision.revision._id;
  assert.deepEqual((await Order.findById(unpaidOrder._id).select('+costSnapshot').lean()).costSnapshot, snapshot);
  assert.equal((await api('GET', path(a, `events/${eventA._id}/report`))).report.recordedProfitPaise, '-10100');
});

test('unknown product costs remain explicitly unknown instead of producing a false profit', async () => {
  const unknown = (await api('POST', path(a, 'products'), { name: 'Uncosted', slug: 'uncosted', category: 'Cookies', pricePaise: 1000 })).product;
  const event = (await api('POST', path(a, 'events'), { name: 'Unknown costs', key: 'unknown-costs' })).event;
  assert.equal((await api('POST', path(a, 'orders'), body({ eventId: event._id, items: [{ productId: unknown._id, quantity: 1, expectedUnitPricePaise: 1000 }] }))).status, 201);
  const report = (await api('GET', path(a, `events/${event._id}/report`))).report;
  assert.equal(report.paidSalesPaise, '1000'); assert.equal(report.unknownCostLines, 1); assert.equal(report.recordedProfitPaise, null);
});

test('simultaneous counter sales cannot oversell and duplicate submissions consume stock only once', async () => {
  const race = (await api('POST', path(a, 'products'), { name: 'Last cake', slug: 'last-cake', category: 'Cakes', pricePaise: 5000, stockCount: 1 })).product;
  const requests = await Promise.all([1, 2].map(() => api('POST', path(a, 'orders'), body({ eventId: null, items: [{ productId: race._id, quantity: 1, expectedUnitPricePaise: 5000 }] }), staffToken)));
  assert.deepEqual(requests.map(row => row.status).sort(), [201, 409]); assert.equal((await Product.findById(race._id)).stockCount, 0);
  const twin = (await api('POST', path(a, 'products'), { name: 'Twin cake', slug: 'twin-cake', category: 'Cakes', pricePaise: 5000, stockCount: 2 })).product;
  const request = body({ eventId: null, items: [{ productId: twin._id, quantity: 1, expectedUnitPricePaise: 5000 }] });
  const responses = await Promise.all([1, 2].map(() => api('POST', path(a, 'orders'), request, staffToken)));
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]); assert.equal(responses[0].order._id, responses[1].order._id);
  assert.equal((await Product.findById(twin._id)).stockCount, 1);
});

test('failed persistence rolls back stock, the order number and the order record', async () => {
  const stock = (await Product.findById(p._id)).stockCount, counter = (await Bakery.findById(a._id)).nextOrderNumber, count = await Order.countDocuments();
  const movements = await Movement.countDocuments();
  const create = Audit.create; Audit.create = async () => { throw new Error('Synthetic sales audit failure'); };
  try { assert.equal((await api('POST', path(a, 'orders'), body(), staffToken)).status, 500); }
  finally { Audit.create = create; }
  assert.equal((await Product.findById(p._id)).stockCount, stock); assert.equal((await Bakery.findById(a._id)).nextOrderNumber, counter);
  assert.equal(await Order.countDocuments(), count); assert.equal(await Movement.countDocuments(), movements);
});

test('closing an event prevents new sales, permits safe retries and allows outstanding dues to be recorded', async () => {
  const pending = (await api('POST', path(a, 'orders'), body({ paymentStatus: 'unpaid', paymentMethod: null }), staffToken)).order;
  const closed = await api('POST', path(a, `events/${eventA._id}/close`), { expectedVersion: 1, confirmed: true });
  assert.equal(closed.status, 200, JSON.stringify(closed));
  const stock = (await Product.findById(p._id)).stockCount;
  assert.equal((await api('POST', path(a, 'orders'), body(), staffToken)).status, 409);
  assert.equal((await Product.findById(p._id)).stockCount, stock);
  assert.equal((await api('POST', path(a, 'orders'), freeBody, staffToken)).status, 200);
  assert.equal((await api('POST', path(a, `orders/${pending._id}/settle`), { expectedVersion: 1, confirmed: true, paymentMethod: 'cash' }, staffToken)).status, 200);
  const list = await api('GET', path(a, 'orders') + '?limit=1&paymentStatus=paid', undefined, staffToken);
  assert.equal(list.orders.length, 1); assert.ok(list.nextCursor);
  assert.equal(list.orders[0].costSnapshot, undefined);
  assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0);
});

test('order numbers are independent per bakery and staff revocation blocks subsequent sales', async () => {
  const created = await api('POST', path(b, 'orders'), { eventId: eventB._id, items: [{ productId: q._id, quantity: 1, expectedUnitPricePaise: 29900 }],
    paymentStatus: 'paid', paymentMethod: 'upi', idempotencyKey: randomUUID() }, otherToken);
  assert.equal(created.status, 201); assert.equal(created.order.orderNumber, 'ORD-000001');
  assert.equal((await api('GET', path(a, `orders/${created.order._id}`))).status, 404);
  assert.equal((await api('GET', path(a, `events/${eventB._id}/report`))).status, 404);
  const { memberWrite } = require('../src/saas/owner-write');
  await Membership.updateOne({ bakeryId: a._id, userId: staff._id }, { $set: { active: false } });
  await assert.rejects(() => memberWrite({ bakeryId: a._id, userId: String(staff._id), role: 'staff' }, () => { throw new Error('must not run'); }), error => error.statusCode === 403);
  assert.equal((await api('POST', path(a, 'orders'), body({ eventId: null }), staffToken)).status, 404);
});

test('a nine-piece batch allocates its original whole-batch cost exactly when all nine pieces sell', async () => {
  const product = (await api('POST', path(a, 'products'), { name: 'Nine-piece batch', slug: 'nine-piece-batch', category: 'Cakes', pricePaise: 10000, stockCount: 9 })).product;
  assert.equal((await api('PATCH', path(a, `products/${product._id}/recipe-mapping`), { revisionId: latestRevisionId, expectedVersion: 1 })).status, 200);
  const event = (await api('POST', path(a, 'events'), { name: 'Nine pieces', key: 'nine-pieces' })).event;
  assert.equal((await api('POST', path(a, 'orders'), body({ eventId: event._id, items: [{ productId: product._id, quantity: 9, expectedUnitPricePaise: 10000 }] }))).status, 201);
  const report = (await api('GET', path(a, `events/${event._id}/report`))).report;
  assert.equal(report.knownSoldCostPaise, '160000'); assert.equal(report.recordedProfitPaise, '-70000');
});

test('stock edits and tracking changes preserve an owner-only paginated quantity history', async () => {
  const product = (await api('POST', path(a, 'products'), { name: 'Stock history', slug: 'stock-history', category: 'Cakes', pricePaise: 1000, stockCount: 10 })).product;
  const uri = path(a, `products/${product._id}`);
  assert.equal((await api('PATCH', uri, { expectedVersion: 1, stockCount: 5 })).status, 200);
  assert.equal((await api('PATCH', uri, { expectedVersion: 2, name: 'New name' })).status, 200);
  assert.equal((await api('PATCH', uri, { expectedVersion: 3, stockCount: null })).status, 200);
  const untrackedSale = body({ eventId: null, items: [{ productId: product._id, quantity: 1, expectedUnitPricePaise: 1000 }] });
  assert.equal((await api('POST', path(a, 'orders'), untrackedSale)).status, 201);
  assert.equal((await api('PATCH', uri, { expectedVersion: 4, stockCount: 7 })).status, 200);
  const history = await api('GET', uri + '/stock-history'); assert.equal(history.status, 200); assert.equal(history.entries.length, 4);
  assert.deepEqual(history.entries.map(row => [row.kind, row.before, row.after, row.delta]), [['tracking', null, 7, null], ['tracking', 5, null, null], ['adjustment', 10, 5, -5], ['opening', null, 10, null]]);
  const first = await api('GET', uri + '/stock-history?limit=1'); assert.ok(first.nextCursor); assert.equal(first.entries.length, 1);
  const next = await api('GET', uri + '/stock-history?limit=1&cursor=' + first.nextCursor); assert.equal(next.entries[0].after, null);
  assert.equal((await api('GET', uri + '/stock-history?limit=101')).status, 400);
  assert.equal((await api('GET', uri + '/stock-history?bakeryId=' + b._id)).status, 400);
});
test('failed audited stock adjustments roll back both stock and movement history', async () => {
  const product = (await api('POST', path(a, 'products'), { name: 'Rollback stock', slug: 'rollback-stock', category: 'Cakes', pricePaise: 1000, stockCount: 3 })).product;
  const original = Audit.create; Audit.create = async () => { throw new Error('Synthetic stock audit failure'); };
  try { assert.equal((await api('PATCH', path(a, `products/${product._id}`), { expectedVersion: 1, stockCount: 10 })).status, 500); }
  finally { Audit.create = original; }
  assert.equal((await Product.findById(product._id)).stockCount, 3); assert.equal(await Movement.countDocuments({ productId: product._id }), 1);
});
