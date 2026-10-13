process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../src/models/Product');
const Recipe = require('../src/models/BakeryRecipe');
const Order = require('../src/models/Order');
const EventPlan = require('../src/models/EventPlan');
let database, server, base, token, customerToken, sequence = 0;
async function api(method, path, body, auth = token) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  token = signToken(await User.create({ name: 'Event manager', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Customer' }));
  await Promise.all([EventPlan.init(), Recipe.init(), Order.init()]);
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
async function fixture() {
  const name = `Event ${++sequence}`;
  const product = await Product.create({ name: `Cake ${sequence}`, slug: `event-cake-${sequence}`, group: 'bakery', category: 'Cakes', price: 40 });
  const recipe = await Recipe.create({ name: `Recipe ${sequence}`, productId: product._id, yieldQuantity: 1, yieldUom: 'cake', piecesPerBatch: 4,
    targetMarkupPercent: 100, components: [{ componentType: 'other', name: 'Ingredients', itemType: 'other', quantity: 1, uom: 'piece', unitCost: '80' }] });
  return { name, product, recipe };
}
function details(f, overrides = {}) {
  return { eventName: f.name, startDate: '2026-10-12', endDate: '2026-10-14', rent: 0, travelCost: 0, extraCost: 0, extraCostNote: '',
    items: [{ productId: String(f.product._id), prepared: 10, wasted: 0, reusable: 0, returned: 0 }], ...overrides };
}
async function plan(f, overrides = {}) {
  const result = await api('POST', '/admin/events', details(f, overrides));
  assert.equal(result.status, 201, JSON.stringify(result)); return result.plan;
}
async function sale(f, quantity, overrides = {}) {
  const items = [{ productId: String(f.product._id), quantity }];
  const quote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  const response = await api('POST', '/admin/orders', { requestKey: randomUUID(), items, orderType: 'takeaway', expectedQuote: quote,
    source: 'event', eventName: f.name, paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed', ...overrides });
  assert.equal(response.status, 201, JSON.stringify(response)); return response.order;
}
async function report(f) {
  const result = await api('GET', `/admin/reports/events?eventName=${encodeURIComponent(f.name)}`);
  assert.equal(result.status, 200, JSON.stringify(result)); return result;
}
async function update(p, items, overrides = {}) {
  return api('PATCH', `/admin/events/${p._id}`, { ...p, items: items || p.items, ...overrides });
}

test('event management and preparation costs are only available to admins', async () => {
  const id = new mongoose.Types.ObjectId();
  for (const auth of [null, customerToken]) for (const [method, path] of [
    ['GET', '/admin/events/products'], ['POST', '/admin/events'], ['GET', `/admin/events/${id}`], ['PATCH', `/admin/events/${id}`],
    ['POST', `/admin/events/${id}/close`], ['POST', `/admin/events/${id}/reopen`],
  ]) assert.equal((await api(method, path, method === 'GET' ? undefined : {}, auth)).status, auth ? 403 : 401);
});

test('preparation is visible before the first sale and accepts only available products with valid linked recipes', async () => {
  const f = await fixture();
  const unavailable = await Product.create({ name: 'Unavailable', slug: 'event-unavailable', category: 'Cakes', group: 'bakery', price: 1, available: false });
  const unmapped = await Product.create({ name: 'Unmapped', slug: 'event-unmapped', category: 'Cakes', group: 'bakery', price: 1 });
  const choices = await api('GET', '/admin/events/products');
  assert.ok(!choices.products.some((p) => p._id === String(unavailable._id)));
  assert.equal(choices.products.find((p) => p._id === String(f.product._id)).unitCost, 20);
  assert.equal(choices.products.find((p) => p._id === String(unmapped._id)).unitCost, null);
  for (const productId of [unavailable._id, unmapped._id]) {
    assert.equal((await api('POST', '/admin/events', details(f, { items: [{ productId: String(productId), prepared: 1 }] }))).status, 400);
  }
  await plan(f);
  const r = await report(f);
  assert.equal(r.events[0].orders, 0); assert.equal(r.events[0].preparedCost, 200); assert.equal(r.events[0].netProfit, -200);
  assert.equal(r.stock[0].prepared, 10); assert.equal(r.stock[0].wasted, 10); assert.equal(r.stock[0].remaining, 0);
  assert.ok(r.eventNames.includes(f.name));
  assert.equal((await Product.findById(f.product._id)).stockCount, 10);
});

test('net profit deducts sold cost, waste, rent, car and extras once, while keeping reusable stock separate', async () => {
  const f = await fixture(); let p = await plan(f, { rent: 30, travelCost: 10, extraCost: 5, extraCostNote: 'Helper' });
  await sale(f, 6);
  p = (await update(p, [{ ...p.items[0], wasted: 2, reusable: 2 }])).plan;
  const r = await report(f); const e = r.events[0];
  assert.equal(e.revenue, 252); assert.equal(e.cost, 120); assert.equal(e.profit, 132); assert.equal(e.wastageCost, 40);
  assert.equal(e.netProfit, 47); assert.equal(e.reusableValue, 40); assert.equal(e.preparedCost, 200); assert.equal(e.extraCostNote, 'Helper');
  assert.equal(r.stock[0].remaining, 0); assert.equal(r.stock[0].handedOver, 6);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 200);
});

test('preparation costs persist and additional pieces capture the newer recipe cost; client cannot forge costs', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 4, unitCost: 0, batches: [] }] });
  assert.equal(p.items[0].unitCost, 20);
  await Recipe.updateOne({ _id: f.recipe._id }, { $set: { 'components.0.unitCost': '120' }, $inc: { version: 1 } });
  const unchanged = await update(p); assert.equal(unchanged.status, 200); p = unchanged.plan;
  assert.equal(p.items[0].unitCost, 20);
  const added = await update(p, [{ ...p.items[0], prepared: 6 }]); assert.equal(added.status, 200); p = added.plan;
  assert.equal((await report(f)).events[0].preparedCost, 140);
  const saved = await EventPlan.findById(p._id);
  assert.deepEqual(saved.items[0].batches.map((b) => [b.quantity, b.unitCost]), [[4, '20'], [2, '30']]);
  await sale(f, 1);
  p = (await update(p, [{ ...p.items[0], wasted: 2, reusable: 3 }])).plan;
  const r = await report(f);
  assert.equal(r.events[0].cost, 30); assert.equal(r.events[0].wastageCost, 46.67); assert.equal(r.events[0].reusableValue, 70);
  assert.equal(r.events[0].netProfit, -13.67);
  const reduced = await update(p, [{ ...p.items[0], prepared: 5, reusable: 2 }]);
  assert.equal(reduced.status, 200); assert.equal((await report(f)).events[0].preparedCost, 110);
});

test('negative net profit is preserved rather than clamped to zero', async () => {
  const f = await fixture(); let p = await plan(f, { rent: 100, items: [{ productId: String(f.product._id), prepared: 2 }] });
  await sale(f, 1); p = (await update(p, [{ ...p.items[0], wasted: 1 }])).plan;
  assert.equal((await report(f)).events[0].netProfit, -98);
});

test('leftovers default to wastage, reusable pieces reduce it, and additional sales update costs without resaving stock', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 20 }] });
  await sale(f, 5);
  let r = await report(f);
  assert.equal(r.stock[0].wasted, 15); assert.equal(r.stock[0].remaining, 0);
  assert.equal(r.events[0].wastageCost, 300); assert.equal(r.events[0].netProfit, -190);
  let loaded = await api('GET', `/admin/events/${p._id}`);
  assert.equal(loaded.plan.items[0].wasted, 15); assert.equal(loaded.plan.items[0].stockOut, 5);
  const saved = await update(p, [{ ...p.items[0], wasted: 0, reusable: 4 }]);
  assert.equal(saved.status, 200); p = saved.plan; assert.equal(p.items[0].wasted, 11);
  r = await report(f);
  assert.equal(r.stock[0].wasted, 11); assert.equal(r.events[0].wastageCost, 220); assert.equal(r.events[0].netProfit, -110);
  await sale(f, 3);
  r = await report(f);
  assert.equal(r.stock[0].wasted, 8); assert.equal(r.stock[0].reusable, 4);
  assert.equal(r.events[0].wastageCost, 160); assert.equal(r.events[0].netProfit, 16);
  loaded = await api('GET', `/admin/events/${p._id}`); assert.equal(loaded.plan.items[0].wasted, 8);
  const closed = await api('POST', `/admin/events/${p._id}/close`, { version: p.version, revision: r.events[0].revision });
  assert.equal(closed.status, 200); assert.equal(closed.plan.items[0].wasted, 8);
});

test('automatic wastage rejects reusable counts beyond available leftovers and still requires every prepared product count', async () => {
  const f = await fixture(); const p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 20 }] });
  await sale(f, 5);
  assert.equal((await update(p, [{ ...p.items[0], reusable: 16 }])).status, 400);
  assert.equal((await report(f)).stock[0].wasted, 15);
  const extra = await fixture(); await sale(extra, 1, { eventName: f.name });
  const r = await report(f);
  assert.equal(r.events[0].netProfit, null);
  assert.equal(r.stock.find((row) => row.productId === String(extra.product._id)).prepared, null);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 400);
});

test('changing prepared quantity in either direction recalculates waste and net profit while preserving sold quantities and costs', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 20 }] });
  const order = await sale(f, 5);
  p = (await update(p, [{ ...p.items[0], reusable: 2 }])).plan;
  for (const [prepared, wasted, preparedCost, wastageCost, netProfit] of [
    [12, 5, 240, 100, 10], [18, 11, 360, 220, -110], [7, 0, 140, 0, 110],
  ]) {
    const saved = await update(p, [{ ...p.items[0], prepared }]);
    assert.equal(saved.status, 200, JSON.stringify(saved)); p = saved.plan;
    assert.equal(p.items[0].prepared, prepared); assert.equal(p.items[0].wasted, wasted); assert.equal(p.items[0].reusable, 2);
    const r = await report(f);
    assert.equal(r.stock[0].prepared, prepared); assert.equal(r.stock[0].wasted, wasted); assert.equal(r.stock[0].sold, 5);
    assert.equal(r.events[0].preparedCost, preparedCost); assert.equal(r.events[0].wastageCost, wastageCost); assert.equal(r.events[0].netProfit, netProfit);
    assert.equal(r.events[0].cost, 100); assert.equal(r.events[0].revenue, 210);
    const reloaded = await api('GET', `/admin/events/${p._id}`);
    assert.equal(reloaded.plan.items[0].prepared, prepared); assert.equal(reloaded.plan.items[0].wasted, wasted);
  }
  assert.equal((await update(p, [{ ...p.items[0], prepared: 6 }])).status, 400);
  assert.equal((await report(f)).stock[0].prepared, 7);
  const storedOrder = await Order.findById(order._id).select('+recipeCostSnapshot');
  assert.equal(storedOrder.items[0].quantity, 5); assert.equal(storedOrder.recipeCostSnapshot[0].unitCost, '20');
});

test('unpaid handovers consume stock separately from paid sales and must be settled before closing', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 4 }] });
  const order = await sale(f, 2, { paymentStatus: 'pending' });
  p = (await update(p, [{ ...p.items[0], reusable: 2 }])).plan;
  let r = await report(f);
  assert.equal(r.events[0].units, 0); assert.equal(r.stock[0].handedOver, 2); assert.equal(r.stock[0].unpaidHandovers, 2);
  assert.equal(r.stock[0].remaining, 0);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 400);
  assert.equal((await api('POST', `/admin/orders/${order._id}/settle-manual`, {})).status, 200);
  r = await report(f); assert.equal(r.stock[0].sold, 2); assert.equal(r.stock[0].unpaidHandovers, 0);
  assert.equal(r.events[0].wastageCost, 0); assert.equal(r.events[0].netProfit, 44);
});

test('refunded handovers remain physical consumption; confirmed returns can be reused without duplicate losses', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 6 }] });
  await sale(f, 2); const refunded = await sale(f, 2);
  assert.equal((await api('POST', `/admin/orders/${refunded._id}/refund`, { reason: 'Customer unhappy' })).status, 200);
  p = (await update(p, [{ ...p.items[0], wasted: 1, reusable: 1 }])).plan;
  let r = await report(f);
  assert.equal(r.events[0].units, 2); assert.equal(r.stock[0].handedOver, 4); assert.equal(r.stock[0].refundedHandovers, 2);
  assert.equal(r.events[0].handoverLossCost, 40); assert.equal(r.events[0].wastageCost, 60); assert.equal(r.events[0].netProfit, -16);
  p = (await update(p, [{ ...p.items[0], returned: 2, wasted: 1, reusable: 3 }])).plan;
  r = await report(f);
  assert.equal(r.events[0].handoverLossCost, 0); assert.equal(r.events[0].wastageCost, 20); assert.equal(r.events[0].netProfit, 24);
  assert.equal((await update(p, [{ ...p.items[0], returned: 3 }])).status, 400);
});

test('closing requires finished orders; cancelling a sale moves its leftover pieces into automatic wastage', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 4 }] });
  const waiting = await sale(f, 2, { orderStatus: 'confirmed' });
  p = (await update(p, [{ ...p.items[0], reusable: 2 }])).plan;
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 400);
  assert.equal((await api('PATCH', `/admin/orders/${waiting._id}/status`, { status: 'cancelled', note: 'Cancelled' })).status, 200);
  assert.equal((await report(f)).events[0].units, 0);
  assert.equal((await report(f)).stock[0].wasted, 2);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 200);
});

test('closed reports freeze historical estimates, guard order changes, and recalculate when reopened', async () => {
  const f = await fixture();
  const order = await Order.create({ orderNumber: `LEGACY-EVENT-${sequence}`, source: 'event', eventName: f.name, orderType: 'takeaway', paymentStatus: 'paid', orderStatus: 'completed',
    items: [{ product: f.product._id, name: f.product.name, price: 50, quantity: 2, lineTotal: 100 }], pricing: { subtotal: 100, tax: 0, total: 100 } });
  let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 4, wasted: 1, reusable: 1 }] });
  const closed = await api('POST', `/admin/events/${p._id}/close`, { version: p.version });
  assert.equal(closed.status, 200, JSON.stringify(closed)); p = closed.plan;
  await Recipe.updateOne({ _id: f.recipe._id }, { $set: { 'components.0.unitCost': '160' } });
  let r = await report(f);
  assert.equal(r.events[0].netProfit, 40); assert.equal(r.products[0].cost, 40); assert.equal(r.events[0].status, 'closed');
  await Order.updateOne({ _id: order._id }, { $set: { 'pricing.total': 101 } });
  r = await report(f); assert.equal(r.events[0].changedSinceClose, true); assert.equal(r.events[0].netProfit, 40);
  assert.equal((await update(p)).status, 409);
  for (const [method, path, body] of [
    ['DELETE', `/admin/orders/${order._id}`], ['POST', `/admin/orders/${order._id}/refund`, { reason: 'Test' }],
    ['PATCH', `/admin/orders/${order._id}/status`, { status: 'cancelled', note: 'Test' }],
    ['POST', `/admin/orders/${order._id}/settle-manual`, {}], ['POST', `/admin/orders/${order._id}/settle-cash`, {}],
  ]) assert.equal((await api(method, path, body)).status, 409);
  const items = [{ productId: String(f.product._id), quantity: 1 }];
  const quote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  assert.equal((await api('POST', '/admin/orders', { requestKey: randomUUID(), items, orderType: 'takeaway', expectedQuote: quote,
    source: 'event', eventName: f.name.toUpperCase(), paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed' })).status, 409);
  const reopened = await api('POST', `/admin/events/${p._id}/reopen`, { version: p.version });
  assert.equal(reopened.status, 200);
  r = await report(f); assert.equal(r.events[0].cost, 80); assert.equal(r.events[0].netProfit, 1);
  assert.equal(r.events[0].preparedCost, 80);
});

test('stale and concurrent changes cannot overwrite preparation or reopen the wrong version', async () => {
  const f = await fixture(); const p = await plan(f);
  const responses = await Promise.all([update(p, undefined, { rent: 1 }), update(p, undefined, { rent: 2 })]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await update(p)).status, 409);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 409);
  assert.equal((await api('POST', `/admin/events/${p._id}/reopen`, { version: p.version })).status, 409);
});

test('closing rejects new order activity since the admin reviewed the report', async () => {
  const f = await fixture(); const p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 10, reusable: 10 }] });
  const reviewed = await report(f);
  await sale(f, 1);
  const result = await api('POST', `/admin/events/${p._id}/close`, { version: p.version, revision: reviewed.events[0].revision });
  assert.equal(result.status, 409); assert.match(result.message, /Orders changed/);
  assert.equal((await EventPlan.findById(p._id)).status, 'open');
});

test('names, dates, expenses and stock quantities reject invalid values without saving partial data', async () => {
  const f = await fixture();
  for (const overrides of [{ eventName: ' ' }, { startDate: '2026-02-30' }, { endDate: '2026-10-01' },
    { rent: -1 }, { travelCost: 0.001 }, { extraCost: '50' }, { extraCostNote: 'x'.repeat(1001) },
    { items: [{ productId: String(f.product._id), prepared: 1.5 }] },
    { items: [{ productId: String(f.product._id), prepared: 1, reusable: 2 }] },
    { items: [{ productId: String(f.product._id), prepared: 2 }, { productId: String(f.product._id), prepared: 2 }] },
  ]) assert.equal((await api('POST', '/admin/events', details(f, overrides))).status, 400, JSON.stringify(overrides));
  assert.equal(await EventPlan.countDocuments({ eventKey: f.name.toLowerCase() }), 0);
  const p = await plan(f);
  assert.equal((await api('POST', '/admin/events', details(f, { eventName: `  ${f.name.toUpperCase()}  ` }))).status, 409);
  assert.equal((await update(p, undefined, { eventName: 'Renamed' })).status, 400);
  assert.equal((await api('GET', '/admin/events/invalid')).status, 404);
});

test('saved prepared products can still be reconciled after they become unavailable', async () => {
  const f = await fixture(); let p = await plan(f);
  await Product.updateOne({ _id: f.product._id }, { $set: { available: false, archived: true } });
  const result = await update(p, [{ ...p.items[0], wasted: 10 }]);
  assert.equal(result.status, 200, JSON.stringify(result)); p = result.plan;
  assert.equal((await report(f)).events[0].wastageCost, 200);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 200);
});

test('all-events reports keep closed product totals and selected-event filtering consistent', async () => {
  const all = await api('GET', '/admin/reports/events');
  assert.equal(all.status, 200);
  const closed = all.events.find((e) => e.status === 'closed' && e.units > 0);
  const one = await api('GET', `/admin/reports/events?eventName=${encodeURIComponent(closed.eventName)}`);
  assert.equal(one.events.length, 1); assert.equal(one.events[0].netProfit, closed.netProfit);
  assert.ok(one.stock.every((p) => p.eventName === closed.eventName));
  for (const product of one.products) assert.ok(all.products.some((p) => p._id === product._id && p.cost === product.cost));
});

test('product rows compare sold and prepared totals and subtract all prepared cost even when stock is reusable', async () => {
  const f = await fixture(); let p = await plan(f, { items: [{ productId: String(f.product._id), prepared: 20 }] });
  let r = await report(f); let row = r.products.find((product) => product._id === String(f.product._id));
  assert.equal(row.quantity, 0); assert.equal(row.totalUnits, 20); assert.equal(row.cost, 0);
  assert.equal(row.totalCost, 400); assert.equal(row.subtotal, 0); assert.equal(row.profit, -400);
  await sale(f, 5);
  p = (await update(p, [{ ...p.items[0], reusable: 4 }])).plan;
  r = await report(f); row = r.products[0];
  assert.equal(row.quantity, 5); assert.equal(row.totalUnits, 20); assert.equal(row.cost, 100);
  assert.equal(row.totalCost, 400); assert.equal(row.subtotal, 200); assert.equal(row.profit, -200);
  assert.equal((await api('POST', `/admin/events/${p._id}/close`, { version: p.version })).status, 200);
  await Recipe.updateOne({ _id: f.recipe._id }, { $set: { 'components.0.unitCost': '120' }, $inc: { version: 1 } });
  r = await report(f); assert.equal(r.products[0].totalCost, 400); assert.equal(r.products[0].profit, -200);
  const second = { ...f, name: f.name + ' second edition' };
  await plan(second, { items: [{ productId: String(f.product._id), prepared: 10 }] });
  await sale(second, 3);
  let all = await api('GET', '/admin/reports/events'); row = all.products.find((product) => product._id === String(f.product._id));
  assert.equal(row.quantity, 8); assert.equal(row.totalUnits, 30); assert.equal(row.cost, 190);
  assert.equal(row.totalCost, 700); assert.equal(row.subtotal, 380); assert.equal(row.profit, -320);
  r = await report(second); assert.equal(r.products[0].totalUnits, 10); assert.equal(r.products[0].totalCost, 300); assert.equal(r.products[0].profit, -120);
  await sale({ ...f, name: f.name + ' no preparation record' }, 1);
  all = await api('GET', '/admin/reports/events'); row = all.products.find((product) => product._id === String(f.product._id));
  assert.equal(row.quantity, 9); assert.equal(row.totalUnits, null); assert.equal(row.totalCost, null); assert.equal(row.profit, null);
});

test('event preparation changes today stock by the difference, preserving sales and rolling back invalid edits', async () => {
  const f = await fixture(); let p = await plan(f);
  await sale(f, 3);
  assert.equal((await Product.findById(f.product._id)).stockCount, 7);
  p = (await update(p, undefined, { rent: 25 })).plan;
  assert.equal((await Product.findById(f.product._id)).stockCount, 7);
  for (const [prepared, expected] of [[14, 11], [9, 6]]) {
    const result = await update(p, [{ ...p.items[0], prepared }]);
    assert.equal(result.status, 200, JSON.stringify(result)); p = result.plan;
    assert.equal((await Product.findById(f.product._id)).stockCount, expected);
  }
  assert.equal((await update(p, [{ ...p.items[0], prepared: 2 }])).status, 400);
  assert.equal((await Product.findById(f.product._id)).stockCount, 6);
  assert.equal((await api('GET', `/admin/events/${p._id}`)).plan.items[0].prepared, 9);
});

test('multiple events add preparation to existing stock and removing preparation removes only its unsold quantity', async () => {
  const f = await fixture(); await Product.updateOne({ _id: f.product._id }, { stockCount: 5 });
  await plan(f); await sale(f, 3);
  assert.equal((await Product.findById(f.product._id)).stockCount, 12);
  const second = { ...f, name: f.name + ' next stall' };
  const p = await plan(second, { items: [{ productId: String(f.product._id), prepared: 4 }] });
  assert.equal((await Product.findById(f.product._id)).stockCount, 16);
  assert.equal((await update(p, [])).status, 200);
  assert.equal((await Product.findById(f.product._id)).stockCount, 12);
});

test('setting up a legacy event adds unsold stock only and new preparation restores automatic sold-out availability', async () => {
  const f = await fixture(); await sale(f, 3);
  let p = await plan(f);
  assert.equal((await Product.findById(f.product._id)).stockCount, 7);
  await sale(f, 7);
  let stored = await Product.findById(f.product._id);
  assert.equal(stored.stockCount, 0); assert.equal(stored.available, false); assert.equal(stored.stockSoldOut, true);
  const choices = await api('GET', '/admin/events/products');
  assert.ok(choices.products.some((item) => item._id === String(f.product._id)));
  const result = await update(p, [{ ...p.items[0], prepared: 12 }]);
  assert.equal(result.status, 200, JSON.stringify(result)); p = result.plan;
  stored = await Product.findById(f.product._id);
  assert.equal(stored.stockCount, 2); assert.equal(stored.available, true); assert.equal(stored.stockSoldOut, false);
  assert.equal((await update(p, undefined, { extraCost: 10 })).status, 200);
  assert.equal((await Product.findById(f.product._id)).stockCount, 2);
});

test('reset today stock is admin-only, covers all products and leaves prices, orders and event preparation unchanged', async () => {
  for (const auth of [null, customerToken]) assert.equal((await api('POST', '/admin/products/reset-stock', {}, auth)).status, auth ? 403 : 401);
  const f = await fixture(); let p = await plan(f); const order = await sale(f, 2);
  const off = await Product.create({ name: 'Off reset stock', slug: 'off-reset-stock', group: 'bakery', category: 'Cakes', price: 17, stockCount: 6, available: false });
  const archived = await Product.create({ name: 'Archived reset stock', slug: 'archived-reset-stock', group: 'bakery', category: 'Cakes', price: 19, stockCount: 5, available: false, archived: true });
  const result = await api('POST', '/admin/products/reset-stock', {});
  assert.equal(result.status, 200, JSON.stringify(result)); assert.ok(result.count >= 3);
  assert.equal(await Product.countDocuments({ stockCount: { $ne: 0 } }), 0);
  const stored = await Product.findById(f.product._id);
  assert.equal(stored.price, f.product.price); assert.equal(stored.available, false); assert.equal(stored.stockSoldOut, true);
  assert.equal((await Product.findById(off._id)).stockSoldOut, false);
  assert.equal((await Product.findById(archived._id)).price, 19);
  assert.equal((await Product.findById(archived._id)).stockSoldOut, false);
  assert.equal((await Order.findById(order._id)).items[0].quantity, 2);
  assert.equal((await api('GET', `/admin/events/${p._id}`)).plan.items[0].prepared, 10);
  p = (await update(p, undefined, { rent: 50 })).plan;
  assert.equal((await Product.findById(f.product._id)).stockCount, 0);
  const choices = await api('GET', '/admin/events/products');
  assert.ok(choices.products.some((item) => item._id === String(f.product._id)));
  assert.ok(!choices.products.some((item) => item._id === String(off._id)));
  const updated = await update(p, [{ ...p.items[0], prepared: 15 }]);
  assert.equal(updated.status, 200, JSON.stringify(updated));
  assert.equal((await Product.findById(f.product._id)).stockCount, 5);
  assert.equal((await Product.findById(f.product._id)).available, true);
});
