process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Membership = require('../src/models/BakeryMembership');
const Product = require('../src/models/SaasProduct');
const Stock = require('../src/models/SaasMaterialStock');
const Movement = require('../src/models/SaasMaterialMovement');
const Run = require('../src/models/SaasProductionRun');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, token, staffToken, otherToken, a, b, flour, boxes, oven, product, revision;
const path = (bakery, suffix = 'inventory') => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const manual = (material, extra = {}) => ({ materialId: material._id, kind: 'opening', quantity: '1000', uom: material.packUom, expectedMaterialVersion: material.version, expectedStockVersion: 0, reason: 'Synthetic counted inventory', ...extra });
const save = body => api('POST', path(a), { ...body, confirmed: true, idempotencyKey: randomUUID() });
async function productionInput(batches = 2) {
  const current = await Product.findById(product._id);
  return { productId: product._id, revisionId: revision._id, expectedProductVersion: current.version, batches, note: 'Tracked production' };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'], }, instanceOpts: [{ launchTimeout: 60000 }] });
  await mongoose.connect(database.getUri('saas_inventory_test'));
  const [owner, employee, stranger] = await User.create([{ name: 'Inventory owner' }, { name: 'Inventory staff' }, { name: 'Other inventory owner' }]);
  token = signToken(owner); staffToken = signToken(employee); otherToken = signToken(stranger);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await api('POST', '/saas/bakeries', { name: 'Inventory A', slug: 'inventory-a' })).bakery;
  b = (await api('POST', '/saas/bakeries', { name: 'Inventory B', slug: 'inventory-b' }, otherToken)).bakery;
  await Membership.create({ bakeryId: a._id, userId: employee._id, role: 'staff' });
  const createMaterial = async body => (await api('POST', path(a, 'materials'), body)).material;
  flour = await createMaterial({ name: 'Flour', packQuantity: '1000', packUom: 'g', purchasePricePaise: 10000 });
  boxes = await createMaterial({ name: 'Boxes', type: 'packaging', packQuantity: '10', packUom: 'piece', purchasePricePaise: 1000 });
  oven = await createMaterial({ name: 'Oven', type: 'resource', packQuantity: '16', packUom: 'minute', purchasePricePaise: 1600 });
  const recipe = await api('POST', path(a, 'recipes'), { name: 'Demo batch', category: 'Cakes', yieldPieces: 9, ingredients: [
    { materialId: flour._id, expectedVersion: 1, quantity: '200', uom: 'g' }, { materialId: flour._id, expectedVersion: 1, quantity: '50', uom: 'g' },
    { materialId: boxes._id, expectedVersion: 1, quantity: '2', uom: 'piece' }, { materialId: oven._id, expectedVersion: 1, quantity: '16', uom: 'minute' }] });
  assert.equal(recipe.status, 201); revision = recipe.revision;
  product = (await api('POST', path(a, 'products'), { name: 'Demo cake', slug: 'cake', category: 'Cakes', pricePaise: 10000, stockCount: 0 })).product;
  assert.equal((await api('PATCH', path(a, `products/${product._id}/recipe-mapping`), { revisionId: revision._id, expectedVersion: 1 })).status, 200);
});
after(async () => {
  if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop();
});
test('opening balances are explicitly reviewed, normalized and idempotent without touching product stock', async () => {
  const body = manual(flour, { quantity: '1', uom: 'kg' });
  const quote = await api('POST', path(a, 'inventory/quote'), body); assert.equal(quote.status, 200); assert.equal(quote.quote.after, '1000'); assert.equal(quote.quote.unit, 'g'); assert.equal(quote.quote.before, null);
  assert.equal(await Stock.countDocuments(), 0);
  const request = { ...body, confirmed: true, idempotencyKey: randomUUID() };
  const results = await Promise.all([api('POST', path(a), request), api('POST', path(a), request)]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 201]); assert.equal(await Stock.countDocuments(), 1); assert.equal(await Movement.countDocuments(), 1);
  assert.equal(results[0].entry.estimatedCostPaise, '10000'); assert.equal(results[0].entry.actorId, undefined); assert.equal(results[0].entry.requestHash, undefined);
  const mismatch = await api('POST', path(a), { ...request, quantity: '2' }); assert.equal(mismatch.status, 409); assert.equal(mismatch.details.code, 'INVENTORY_KEY_CONFLICT');
  assert.equal((await Product.findById(product._id)).stockCount, 0);
  assert.equal((await save(manual(boxes, { quantity: '10' }))).status, 201);
  assert.equal((await save(manual(oven, { quantity: '1' }))).status, 400);
});
test('receipts and raw-material wastage retain exact quantities and price snapshots', async () => {
  const receipt = await save(manual(flour, { kind: 'receipt', quantity: '0.25', uom: 'kg', expectedStockVersion: 1 }));
  assert.equal(receipt.status, 201); assert.equal(receipt.entry.after, '1250'); assert.equal(receipt.entry.estimatedCostPaise, '2500');
  const waste = await save(manual(flour, { kind: 'waste', quantity: '0.125', uom: 'kg', expectedStockVersion: 2 }));
  assert.equal(waste.status, 201); assert.equal(waste.entry.after, '1125'); assert.equal(waste.entry.quantity, '125'); assert.equal(waste.entry.estimatedCostPaise, '1250');
  assert.equal((await save(manual(flour, { kind: 'waste', quantity: '2000', expectedStockVersion: 3 }))).status, 409);
  assert.equal((await Stock.findOne({ materialId: flour._id })).onHand, '1125');
  const changed = await api('PATCH', path(a, `materials/${flour._id}`), { expectedVersion: 1, purchasePricePaise: 20000 }); assert.equal(changed.status, 200); flour.version = changed.material.version;
  const history = await api('GET', path(a, `inventory/${flour._id}/history`)); assert.equal(history.entries[0].estimatedCostPaise, '1250');
});
test('production aggregates repeated ingredient lines, deducts tracked materials, and leaves resources untracked', async () => {
  const input = await productionInput(), plan = await api('POST', path(a, 'production/quote'), input); assert.equal(plan.status, 200);
  assert.equal(plan.quote.materialUsage.length, 2);
  const flourPlan = plan.quote.materialUsage.find(row => row.materialId === flour._id); assert.equal(flourPlan.quantity, '500'); assert.equal(flourPlan.after, '625');
  const body = { ...input, inventoryFingerprint: plan.quote.inventoryFingerprint, confirmed: true, idempotencyKey: randomUUID() };
  const created = await api('POST', path(a, 'production'), body); assert.equal(created.status, 201, JSON.stringify(created)); assert.equal(created.run.materialUsage.length, 2);
  assert.equal((await Stock.findOne({ materialId: flour._id })).onHand, '625'); assert.equal((await Stock.findOne({ materialId: boxes._id })).onHand, '6');
  assert.equal((await Product.findById(product._id)).stockCount, 18); assert.equal(await Movement.countDocuments({ productionRunId: created.run._id }), 2);
  assert.equal((await api('POST', path(a, 'production'), body)).replayed, true); assert.equal((await Stock.findOne({ materialId: flour._id })).onHand, '625');
});
test('stale inventory reviews and insufficient material counts cannot partially record production', async () => {
  const input = await productionInput(), plan = await api('POST', path(a, 'production/quote'), input); assert.equal(plan.status, 200);
  const stock = await Stock.findOne({ materialId: flour._id });
  assert.equal((await save(manual(flour, { kind: 'receipt', quantity: '1000', expectedStockVersion: stock.version }))).status, 201);
  const rejected = await api('POST', path(a, 'production'), { ...input, inventoryFingerprint: plan.quote.inventoryFingerprint, confirmed: true, idempotencyKey: randomUUID() });
  assert.equal(rejected.status, 409); assert.equal(rejected.details.code, 'PRODUCTION_REJECTED'); assert.equal((await Product.findById(product._id)).stockCount, 18);
  const missingReview = await api('POST', path(a, 'production'), { ...input, confirmed: true, idempotencyKey: randomUUID() }); assert.equal(missingReview.status, 409);
  const tooMuch = await api('POST', path(a, 'production/quote'), await productionInput(10)); assert.equal(tooMuch.status, 409); assert.equal(await Run.countDocuments(), 1);
});
test('audit failures roll back manual balances and production material consumption together', async () => {
  const stock = await Stock.findOne({ materialId: flour._id }), movements = await Movement.countDocuments();
  const original = Audit.create; Audit.create = async () => { throw new Error('Synthetic inventory audit failure'); };
  try { assert.equal((await save(manual(flour, { kind: 'waste', quantity: '100', expectedStockVersion: stock.version }))).status, 500); }
  finally { Audit.create = original; }
  assert.equal((await Stock.findById(stock._id)).onHand, stock.onHand); assert.equal(await Movement.countDocuments(), movements);
  const input = await productionInput(), plan = await api('POST', path(a, 'production/quote'), input);
  Audit.create = async () => { throw new Error('Synthetic production inventory audit failure'); };
  try { assert.equal((await api('POST', path(a, 'production'), { ...input, inventoryFingerprint: plan.quote.inventoryFingerprint, confirmed: true, idempotencyKey: randomUUID() })).status, 500); }
  finally { Audit.create = original; }
  assert.equal((await Stock.findById(stock._id)).onHand, stock.onHand); assert.equal(await Movement.countDocuments(), movements); assert.equal(await Run.countDocuments(), 1);
});
test('inventory is owner-only and rejects foreign references, incompatible changes and unsafe inputs', async () => {
  for (const [method, suffix, body] of [['GET', 'inventory', undefined], ['POST', 'inventory/quote', manual(flour)], ['POST', 'inventory', { ...manual(flour), confirmed: true, idempotencyKey: randomUUID() }], ['GET', `inventory/${flour._id}/history`, undefined]]) {
    assert.equal((await api(method, path(a, suffix), body, staffToken)).status, 403);
    assert.equal((await api(method, path(a, suffix), body, otherToken)).status, 404);
  }
  assert.equal((await api('POST', path(b), { ...manual(flour), confirmed: true, idempotencyKey: randomUUID() }, otherToken)).status, 404);
  assert.equal((await api('PATCH', path(a, `materials/${flour._id}`), { expectedVersion: flour.version, packUom: 'ml' })).status, 409);
  assert.equal((await api('PATCH', path(a, `materials/${flour._id}`), { expectedVersion: flour.version, type: 'resource' })).status, 409);
  for (const extra of [{ quantity: '-1' }, { quantity: '0', kind: 'receipt' }, { quantity: '1.0000001' }, { quantity: 1 }, { uom: 'constructor' }, { uom: 'minute' }, { estimatedCostPaise: '0' }]) assert.equal((await save({ ...manual(flour), ...extra })).status, 400);
  assert.equal((await api('POST', path(a), { ...manual(flour), confirmed: false, idempotencyKey: randomUUID() })).status, 400);
  const history = await api('GET', path(a, `inventory/${flour._id}/history`) + '?limit=1'); assert.equal(history.entries.length, 1); assert.ok(history.nextCursor);
  const listed = await api('GET', path(a)); assert.equal(listed.stocks.length, 2); assert.equal((await api('GET', path(b), undefined, otherToken)).stocks.length, 0);
  assert.equal(await mongoose.connection.collection('bakerymovements').countDocuments(), 0);
});

test('count corrections set a measured balance without inventing a receipt or wastage', async () => {
  const current = await Stock.findOne({ materialId: flour._id }), request = { ...manual(flour, { kind: 'count', quantity: '1.5', uom: 'kg', expectedStockVersion: current.version, reason: 'Physical count correction' }), confirmed: true, idempotencyKey: randomUUID() };
  const quote = await api('POST', path(a, 'inventory/quote'), Object.fromEntries(Object.entries(request).filter(([key]) => !['confirmed', 'idempotencyKey'].includes(key))));
  assert.equal(quote.status, 200); assert.equal(quote.quote.after, '1500');
  const result = await api('POST', path(a), request); assert.equal(result.status, 201); assert.equal(result.entry.kind, 'count'); assert.equal(result.entry.after, '1500');
  assert.equal((await api('POST', path(a), request)).replayed, true); assert.equal((await Stock.findById(current._id)).onHand, '1500');
});
