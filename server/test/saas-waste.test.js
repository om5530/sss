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
const Waste = require('../src/models/SaasWaste');
const Movement = require('../src/models/SaasStockMovement');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, token, staffToken, otherToken, a, b, product, revision, event, foreignEvent, material, firstBody;
const path = (bakery, suffix = 'waste') => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const input = (extra = {}) => ({ productId: product._id, eventId: event._id, quantity: 1, expectedProductVersion: product.version, reason: 'Already discarded spoiled cake', ...extra });
const save = (body = input()) => api('POST', path(a), { ...body, confirmed: true, idempotencyKey: randomUUID() });
async function newProduct(slug, stockCount = 5, mapped = false) {
  const created = (await api('POST', path(a, 'products'), { name: slug, slug, category: 'Cakes', pricePaise: 19900, stockCount })).product;
  if (mapped) created.version = (await api('PATCH', path(a, `products/${created._id}/recipe-mapping`), { revisionId: revision._id, expectedVersion: 1 })).product.version;
  return created;
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] });
  await mongoose.connect(database.getUri('saas_waste_test'));
  const [owner, employee, stranger] = await User.create([{ name: 'Waste owner' }, { name: 'Waste staff' }, { name: 'Other waste owner' }]); token = signToken(owner); staffToken = signToken(employee); otherToken = signToken(stranger);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await api('POST', '/saas/bakeries', { name: 'Waste A', slug: 'waste-a' })).bakery; b = (await api('POST', '/saas/bakeries', { name: 'Waste B', slug: 'waste-b' }, otherToken)).bakery;
  await Membership.create({ bakeryId: a._id, userId: employee._id, role: 'staff' });
  material = (await api('POST', path(a, 'materials'), { name: 'Demo batch', packQuantity: '1', packUom: 'piece', purchasePricePaise: 10000 })).material;
  const recipe = await api('POST', path(a, 'recipes'), { name: 'Nine pieces', category: 'Cakes', yieldPieces: 9, ingredients: [{ materialId: material._id, expectedVersion: 1, quantity: '1', uom: 'piece' }] }); revision = recipe.revision;
  product = await newProduct('nine-pieces', 9, true); event = (await api('POST', path(a, 'events'), { name: 'Closed event', key: 'closed-event' })).event;
  foreignEvent = (await api('POST', path(b, 'events'), { name: 'Other event', key: 'event' }, otherToken)).event;
  assert.equal((await api('POST', path(a, `events/${event._id}/close`), { expectedVersion: 1, confirmed: true })).status, 200);
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('wastage quote changes no stock and concurrent retries deduct pieces once with an immutable cost snapshot', async () => {
  const quoted = await api('POST', path(a, 'waste/quote'), input()); assert.equal(quoted.status, 200); assert.equal(quoted.quote.stockAfter, 8); assert.equal(quoted.quote.batchCostPaise, '10000'); assert.equal(quoted.quote.yieldPieces, 9);
  assert.equal(await Waste.countDocuments(), 0); assert.equal((await Product.findById(product._id)).stockCount, 9);
  firstBody = { ...input(), confirmed: true, idempotencyKey: randomUUID() }; const responses = await Promise.all([api('POST', path(a), firstBody), api('POST', path(a), firstBody)]);
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 201]); assert.equal(responses[0].entry._id, responses[1].entry._id); assert.equal((await Product.findById(product._id)).stockCount, 8);
  const entry = responses[0].entry; for (const key of ['actorId', 'requestHash', 'idempotencyKey', 'bakeryId']) assert.equal(entry[key], undefined);
  const movement = await Movement.findOne({ wasteId: entry._id }).lean(); assert.equal(movement.kind, 'waste'); assert.equal(movement.delta, -1);
  const conflict = await api('POST', path(a), { ...firstBody, quantity: 2 }); assert.equal(conflict.status, 409); assert.equal(conflict.details.code, 'WASTE_KEY_CONFLICT');
  product.version = (await Product.findById(product._id)).version;
});
test('event waste costs aggregate whole batches exactly and retain saved pricing after material changes', async () => {
  assert.equal((await api('PATCH', path(a, `materials/${material._id}`), { expectedVersion: 1, purchasePricePaise: 20000 })).status, 200);
  for (let count = 0; count < 8; count++) { const result = await save(); assert.equal(result.status, 201); product.version = result.entry.productVersion; }
  const report = (await api('GET', path(a, `events/${event._id}/report`))).report;
  assert.equal(report.recordedWasteUnits, 9); assert.equal(report.knownWasteCostPaise, '10000'); assert.equal(report.recordedProfitPaise, '-10000'); assert.equal(report.unknownWasteLines, 0); assert.equal(report.includesProductionWaste, false);
  assert.equal((await api('POST', path(a), firstBody)).replayed, true); assert.equal((await Product.findById(product._id)).stockCount, 0);
});
test('unknown saved costs keep event profit unknown instead of counting waste as free', async () => {
  const unknown = await newProduct('uncosted'), otherEvent = (await api('POST', path(a, 'events'), { name: 'Unknown waste', key: 'unknown' })).event;
  const result = await save(input({ productId: unknown._id, expectedProductVersion: unknown.version, eventId: otherEvent._id })); assert.equal(result.status, 201); assert.equal(result.entry.estimatedCostPaise, null);
  const report = (await api('GET', path(a, `events/${otherEvent._id}/report`))).report; assert.equal(report.unknownWasteLines, 1); assert.equal(report.recordedProfitPaise, null);
});
test('owner access, event scope, stock bounds and strict fields are enforced', async () => {
  const valid = await newProduct('valid-stock'), body = input({ productId: valid._id, expectedProductVersion: valid.version });
  for (const [method, suffix, payload] of [['GET', 'waste', undefined], ['POST', 'waste/quote', body], ['POST', 'waste', { ...body, confirmed: true, idempotencyKey: randomUUID() }]]) {
    assert.equal((await api(method, path(a, suffix), payload, staffToken)).status, 403); assert.equal((await api(method, path(a, suffix), payload, otherToken)).status, 404);
  }
  assert.equal((await save({ ...body, eventId: foreignEvent._id })).status, 404);
  for (const extra of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: '1' }, { estimatedCostPaise: '0' }, { eventId: 'invalid' }, { reason: '' }]) assert.equal((await save({ ...body, ...extra })).status, 400);
  assert.equal((await api('POST', path(a), { ...body, confirmed: false, idempotencyKey: randomUUID() })).status, 400);
  const negative = await save({ ...body, quantity: 6 }); assert.equal(negative.status, 409); assert.equal(negative.details.code, 'WASTE_REJECTED');
  const untracked = await newProduct('untracked', null); assert.equal((await save(input({ productId: untracked._id, expectedProductVersion: untracked.version }))).status, 409);
  assert.equal((await api('GET', path(b), undefined, otherToken)).entries.length, 0);
});
test('distinct simultaneous waste submissions cannot consume the same last piece twice', async () => {
  const last = await newProduct('last-piece', 1, true), body = input({ productId: last._id, expectedProductVersion: last.version });
  const responses = await Promise.all([save(body), save(body)]); assert.deepEqual(responses.map(row => row.status).sort(), [201, 409]); assert.equal((await Product.findById(last._id)).stockCount, 0);
});
test('failed audited wastage rolls back the stock count, waste entry and stock movement', async () => {
  const item = await newProduct('rollback-stock', 3, true), count = await Waste.countDocuments(), movements = await Movement.countDocuments(); const original = Audit.create;
  Audit.create = async () => { throw new Error('Synthetic waste audit failure'); };
  try { assert.equal((await save(input({ productId: item._id, expectedProductVersion: item.version }))).status, 500); } finally { Audit.create = original; }
  assert.equal((await Product.findById(item._id)).stockCount, 3); assert.equal(await Waste.countDocuments(), count); assert.equal(await Movement.countDocuments(), movements);
  const history = await api('GET', path(a) + '?limit=1'); assert.equal(history.entries.length, 1); assert.ok(history.nextCursor); assert.equal((await api('GET', path(a) + '?limit=101')).status, 400);
  assert.equal(await mongoose.connection.collection('bakerywastes').countDocuments(), 0);
});
