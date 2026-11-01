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
const Run = require('../src/models/SaasProductionRun');
const Movement = require('../src/models/SaasStockMovement');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, token, staffToken, otherToken, a, b, product, revision, material, firstBody, otherUserId;
const path = (bakery, suffix = 'production') => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
const input = extra => ({ productId: product._id, revisionId: revision._id, expectedProductVersion: product.version, batches: 2, note: 'Synthetic production', ...extra });
const recording = extra => ({ ...input(extra), confirmed: true, idempotencyKey: randomUUID() });
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] } });
  await mongoose.connect(database.getUri('saas_production_test'));
  const [owner, employee, stranger] = await User.create([{ name: 'Production owner' }, { name: 'Production staff' }, { name: 'Other production owner' }]);
  otherUserId = stranger._id;
  token = signToken(owner); staffToken = signToken(employee); otherToken = signToken(stranger);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await api('POST', '/saas/bakeries', { name: 'Production A', slug: 'production-a' })).bakery;
  b = (await api('POST', '/saas/bakeries', { name: 'Production B', slug: 'production-b' }, otherToken)).bakery;
  await Membership.create({ bakeryId: a._id, userId: employee._id, role: 'staff' });
  product = (await api('POST', path(a, 'products'), { name: 'Nine-piece cake', slug: 'cake', category: 'Cakes', pricePaise: 19900, stockCount: 1 })).product;
  material = (await api('POST', path(a, 'materials'), { name: 'Cream', packQuantity: '1000', packUom: 'g', purchasePricePaise: 70000 })).material;
  const recipe = await api('POST', path(a, 'recipes'), { name: 'Cake batch', category: 'Cakes', yieldPieces: 9, overheadPaise: 1600, ingredients: [{ materialId: material._id, expectedVersion: 1, quantity: '125.5', uom: 'g' }] });
  revision = recipe.revision;
  const mapping = await api('PATCH', path(a, `products/${product._id}/recipe-mapping`), { revisionId: revision._id, expectedVersion: product.version }); product.version = mapping.product.version;
});
after(async () => {
  if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop();
});
test('production quote uses mapped immutable revision costs and changes no stock or records', async () => {
  const quoted = await api('POST', path(a, 'production/quote'), input()); assert.equal(quoted.status, 200, JSON.stringify(quoted));
  assert.equal(quoted.quote.producedPieces, 18); assert.equal(quoted.quote.stockBefore, 1); assert.equal(quoted.quote.stockAfter, 19);
  assert.equal(quoted.quote.totalCostPaise, '20770'); assert.equal(quoted.quote.ingredients[0].quantity, '251'); assert.equal(quoted.quote.ingredients[0].costPaise, '17570');
  assert.equal((await Product.findById(product._id)).stockCount, 1); assert.equal(await Run.countDocuments(), 0);
  await api('PATCH', path(a, `materials/${material._id}`), { expectedVersion: 1, purchasePricePaise: 140000 });
  assert.equal((await api('POST', path(a, 'production/quote'), input())).quote.totalCostPaise, '20770');
});
test('confirmed production adds pieces once with snapshot costs, a stock movement and atomic audit', async () => {
  const request = recording(); firstBody = request; const results = await Promise.all([api('POST', path(a), request), api('POST', path(a), request)]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 201]); assert.equal(results[0].run._id, results[1].run._id);
  const run = results[0].run; assert.equal(run.stockAfter, 19); assert.equal(run.totalCostPaise, '20770');
  for (const key of ['actorId', 'bakeryId', 'idempotencyKey', 'requestHash']) assert.equal(run[key], undefined);
  const saved = await Product.findById(product._id); assert.equal(saved.stockCount, 19); product.version = saved.version;
  assert.equal(await Run.countDocuments({ bakeryId: a._id }), 1); assert.equal(await Audit.countDocuments({ action: 'production.record', entityId: run._id }), 1);
  const movement = await Movement.findOne({ productionRunId: run._id }).lean(); assert.equal(movement.kind, 'production'); assert.equal(movement.delta, 18); assert.equal(movement.productVersion, saved.version);
  const ownerMembership = await Membership.create({ bakeryId: a._id, userId: otherUserId, role: 'owner' });
  const wrongActor = await api('POST', path(a), request, otherToken); assert.equal(wrongActor.status, 409); assert.equal(wrongActor.details.code, 'PRODUCTION_KEY_CONFLICT');
  await Membership.deleteOne({ _id: ownerMembership._id });
  const mismatch = await api('POST', path(a), { ...request, batches: 1 }); assert.equal(mismatch.status, 409); assert.equal(mismatch.details.code, 'PRODUCTION_KEY_CONFLICT');
  await api('PATCH', path(a, `products/${product._id}`), { expectedVersion: product.version, archived: true });
  assert.equal((await api('POST', path(a), request)).replayed, true);
  const restored = await api('PATCH', path(a, `products/${product._id}`), { expectedVersion: product.version + 1, archived: false }); product.version = restored.product.version;
});
test('staff, foreign tenant references, overrides and stale mapped versions cannot record production', async () => {
  for (const suffix of ['production', 'production/quote']) assert.equal((await api('POST', path(a, suffix), suffix.endsWith('quote') ? input() : recording(), staffToken)).status, 403);
  assert.equal((await api('GET', path(a), undefined, staffToken)).status, 403);
  assert.equal((await api('POST', path(b), recording(), otherToken)).status, 404);
  for (const extra of [{ batches: 0 }, { batches: 1.5 }, { batches: 1001 }, { totalCostPaise: '0' }, { stockAfter: 999 }, { confirmed: false }, { revisionId: 'invalid' }]) {
    assert.equal((await api('POST', path(a), { ...recording(), ...extra })).status, 400, JSON.stringify(extra));
  }
  const stale = await api('POST', path(a), recording({ expectedProductVersion: 1 })); assert.equal(stale.status, 409); assert.equal(stale.details.code, 'PRODUCTION_REJECTED');
  const wrong = await api('POST', path(a), recording({ revisionId: String(new mongoose.Types.ObjectId()) })); assert.equal(wrong.status, 409);
  assert.equal((await api('GET', path(b), undefined, otherToken)).runs.length, 0);
});
test('competing different production entries must refresh the reviewed product version', async () => {
  const results = await Promise.all([api('POST', path(a), recording({ batches: 1 })), api('POST', path(a), recording({ batches: 1 }))]);
  assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
  const saved = await Product.findById(product._id); assert.equal(saved.stockCount, 28); product.version = saved.version;
});
test('failed production audit restores stock and removes the run and movement', async () => {
  const count = await Run.countDocuments(), movements = await Movement.countDocuments();
  const original = Audit.create; Audit.create = async () => { throw new Error('Synthetic production audit failure'); };
  try { assert.equal((await api('POST', path(a), recording())).status, 500); } finally { Audit.create = original; }
  const saved = await Product.findById(product._id); assert.equal(saved.stockCount, 28); assert.equal(saved.version, product.version);
  assert.equal(await Run.countDocuments(), count); assert.equal(await Movement.countDocuments(), movements);
});
test('untracked products and overflowing stock are rejected and history remains bounded', async () => {
  let changed = await api('PATCH', path(a, `products/${product._id}`), { expectedVersion: product.version, stockCount: null }); product.version = changed.product.version;
  assert.equal((await api('POST', path(a, 'production/quote'), input())).status, 409);
  changed = await api('PATCH', path(a, `products/${product._id}`), { expectedVersion: product.version, stockCount: 999999 }); product.version = changed.product.version;
  assert.equal((await api('POST', path(a), recording())).status, 400);
  const history = await api('GET', path(a) + '?limit=1'); assert.equal(history.runs.length, 1); assert.ok(history.nextCursor);
  assert.equal((await api('GET', path(a) + '?limit=101')).status, 400);
  assert.equal((await api('GET', path(a) + '?bakeryId=' + b._id)).status, 400);
  assert.equal(await mongoose.connection.collection('bakeryproductions').countDocuments(), 0);
});

test('production capacity cannot be bypassed and confirmed retries still work at the ceiling', async () => {
  const { LIMITS } = require('../src/saas/usage-limits'); const count = await Run.countDocuments({ bakeryId: a._id });
  await Run.collection.insertMany(Array.from({ length: LIMITS.productionRuns - count }, (_, i) => ({ bakeryId: new mongoose.Types.ObjectId(a._id), idempotencyKey: `synthetic-run-${i}` })));
  const blocked = await api('POST', path(a), recording()); assert.equal(blocked.status, 409); assert.equal(blocked.details.code, 'PRODUCTION_REJECTED'); assert.match(blocked.message, /limit/);
  assert.equal((await api('POST', path(a), firstBody)).replayed, true);
  const usage = await api('GET', path(a, 'usage')); assert.deepEqual(usage.usage.productionRuns, { used: LIMITS.productionRuns, limit: LIMITS.productionRuns });
  assert.equal((await Product.findById(product._id)).stockCount, 999999);
});
