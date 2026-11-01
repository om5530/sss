process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Bakery = require('../src/models/Bakery');
const Membership = require('../src/models/BakeryMembership');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const SaasProduct = require('../src/models/SaasProduct');
const SaasAuditLog = require('../src/models/SaasAuditLog');
const SaasRecipe = require('../src/models/SaasRecipe');
const SaasRecipeRevision = require('../src/models/SaasRecipeRevision');
const { ownerWrite } = require('../src/saas/owner-write');
const { signToken } = require('../src/services/token.service');
const { foundationAvailable, foundationDatabaseAllowed } = require('../src/config/saas-foundation');
let database, server, base, owner, other, staff, admin, ownerToken, otherToken, staffToken, adminToken, a, b, legacy;
const previousFlag = process.env.SAAS_FOUNDATION_ENABLED;

async function api(method, path, body, token = ownerToken, headers = {}) {
  const response = await fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
}

before(async () => {
  // Generated loopback replica set only. Never read or use MONGODB_URI.
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] } });
  await mongoose.connect(database.getUri('saas_foundation_test'));
  await Promise.all([Bakery, Membership, User, Product].map(model => model.init()));
  [owner, other, staff, admin] = await User.create([
    { name: 'Bakery A owner' }, { name: 'Bakery B owner' }, { name: 'Bakery A staff' }, { name: 'Legacy global admin', role: 'admin' },
  ]);
  [ownerToken, otherToken, staffToken, adminToken] = [owner, other, staff, admin].map(signToken);
  legacy = (await Product.create({ name: 'Untouched legacy cake', slug: 'untouched-legacy-cake', group: 'bakery', category: 'Cakes', price: 149, stockCount: 7 })).toObject();
  process.env.SAAS_FOUNDATION_ENABLED = 'true';
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (previousFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED;
  else process.env.SAAS_FOUNDATION_ENABLED = previousFlag;
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});

test('foundation defaults off and remains off for production, unknown environments and all Vercel deployments', async () => {
  // Fresh process proves disabled startup does not even register SaaS models,
  // so connecting the legacy app cannot trigger automatic SaaS collection DDL.
  const registered = execFileSync(process.execPath, ['-e', `
    require('./src/routes');
    process.stdout.write(JSON.stringify(require('mongoose').modelNames()));
  `], { cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', SAAS_FOUNDATION_ENABLED: 'false' }, encoding: 'utf8' });
  const names = JSON.parse(registered);
  assert.equal(names.includes('Bakery'), false);
  assert.equal(names.includes('BakeryMembership'), false);
  assert.equal(names.includes('SaasProduct'), false);
  assert.equal(names.includes('SaasAuditLog'), false);
  for (const name of ['SaasMedia', 'SaasAccount', 'SaasAccountSession', 'SaasAccountAudit', 'SaasAccountAction', 'SaasAccountMailPreview', 'SaasMaterial', 'SaasRecipe', 'SaasRecipeRevision', 'SaasEvent', 'SaasOrder', 'SaasStockMovement', 'SaasProductionRun', 'SaasMaterialStock', 'SaasMaterialMovement', 'SaasWaste', 'SaasCustomer', 'SaasCustomerSession', 'SaasPaymentEntry', 'SaasOrderChange', 'SaasStorefront', 'SaasInvitation']) assert.equal(names.includes(name), false);
  assert.equal(foundationAvailable({}), false);
  assert.equal(foundationAvailable({ SAAS_FOUNDATION_ENABLED: 'false', NODE_ENV: 'test' }), false);
  for (const NODE_ENV of ['production', 'staging', 'preview']) {
    assert.equal(foundationAvailable({ SAAS_FOUNDATION_ENABLED: 'true', NODE_ENV }), false);
  }
  assert.equal(foundationAvailable({ SAAS_FOUNDATION_ENABLED: 'true', NODE_ENV: 'development', VERCEL: '1' }), false);
  assert.equal(foundationAvailable({ SAAS_FOUNDATION_ENABLED: 'true', NODE_ENV: 'test' }), true);
  for (const connection of [null, {}, { readyState: 0, host: '127.0.0.1', name: 'saas_dev' },
    { readyState: 1, host: 'cluster.example.test', name: 'saas_dev' },
    { readyState: 1, host: '127.0.0.1', name: 'production' },
    { readyState: 1, host: '127.0.0.1', name: 'saas_' }]) assert.equal(foundationDatabaseAllowed(connection), false);
  assert.equal(foundationDatabaseAllowed({ readyState: 1, host: '127.0.0.1', name: 'saas_development' }), true);
  process.env.SAAS_FOUNDATION_ENABLED = 'false';
  try { assert.equal((await api('POST', '/saas/bakeries', { name: 'Disabled', slug: 'disabled' })).status, 404); }
  finally { process.env.SAAS_FOUNDATION_ENABLED = 'true'; }
  assert.equal(await Bakery.countDocuments(), 0);
});

test('bakery creation requires authentication, validates exact inputs and creates owner membership atomically', async () => {
  assert.equal((await api('GET', '/saas/bakeries', undefined, null)).status, 401);
  assert.equal((await api('POST', '/saas/bakeries', { name: 'Anonymous', slug: 'anonymous' }, null)).status, 401);
  for (const body of [null, [], {}, { name: '', slug: 'empty' }, { name: 'A', slug: 'admin' },
    { name: 'A', slug: 'x' }, { name: 'A', slug: '-invalid-' }, { name: 'A', slug: 'valid', role: 'owner' },
    { name: 'A', slug: 'valid', createdBy: other._id }, { name: 'A', slug: 'valid', status: 'active' }]) {
    assert.equal((await api('POST', '/saas/bakeries', body)).status, 400, JSON.stringify(body));
  }
  const first = await api('POST', '/saas/bakeries', { name: '  Bakery A  ', slug: '  BAKERY-A  ' });
  assert.equal(first.status, 201, JSON.stringify(first)); a = first.bakery;
  assert.equal(first.cache, 'no-store'); assert.equal(first.role, 'owner');
  assert.equal(a.name, 'Bakery A'); assert.equal(a.slug, 'bakery-a');
  assert.equal(a.createdBy, undefined); assert.equal(a.currency, 'inr'); assert.equal(a.timezone, 'Asia/Kolkata');
  assert.equal((await Membership.findOne({ bakeryId: a._id, userId: owner._id })).role, 'owner');
  assert.equal((await User.findById(owner._id)).role, 'customer');
  const second = await api('POST', '/saas/bakeries', { name: 'Bakery B', slug: 'bakery-b' }, otherToken);
  assert.equal(second.status, 201, JSON.stringify(second)); b = second.bakery;
  assert.equal((await api('POST', '/saas/bakeries', { name: 'Duplicate', slug: 'BAKERY-A' }, otherToken)).status, 409);
  assert.equal(await Membership.countDocuments(), 2);
});

test('a failed owner-membership write rolls back bakery creation', async () => {
  const create = Membership.create;
  Membership.create = async () => { throw new Error('Simulated membership failure'); };
  try {
    const failed = await api('POST', '/saas/bakeries', { name: 'Rollback', slug: 'rollback-bakery' });
    assert.equal(failed.status, 500);
  } finally { Membership.create = create; }
  assert.equal(await Bakery.countDocuments({ slug: 'rollback-bakery' }), 0);
});

test('membership listing and context do not leak another bakery, including to a global admin', async () => {
  for (const [token, expected] of [[ownerToken, a._id], [otherToken, b._id]]) {
    const result = await api('GET', '/saas/bakeries', undefined, token);
    assert.equal(result.status, 200); assert.deepEqual(result.bakeries.map(x => x._id), [expected]);
  }
  assert.deepEqual((await api('GET', '/saas/bakeries', undefined, adminToken)).bakeries, []);
  for (const token of [otherToken, staffToken, adminToken]) {
    assert.equal((await api('GET', `/saas/bakeries/${a._id}/context`, undefined, token)).status, 404);
  }
  for (const id of ['invalid', String(new mongoose.Types.ObjectId())]) {
    assert.equal((await api('GET', `/saas/bakeries/${id}/context`)).status, 404);
  }
  const context = await api('GET', `/saas/bakeries/${a._id}/context`);
  assert.equal(context.status, 200); assert.equal(context.role, 'owner'); assert.equal(context.bakery._id, a._id);
  const spoofed = await api('GET', `/saas/bakeries/${b._id}/context`, undefined, ownerToken, { 'X-Bakery-ID': a._id });
  assert.equal(spoofed.status, 404);
  assert.equal((await api('GET', `/saas/bakeries/${b._id}/context?bakeryId=${a._id}`)).status, 404);
});

test('staff permissions, revocation and suspension are read fresh for every request', async () => {
  const member = await Membership.create({ bakeryId: a._id, userId: staff._id, role: 'staff' });
  assert.equal((await api('GET', `/saas/bakeries/${a._id}/context`, undefined, staffToken)).role, 'staff');
  assert.equal((await api('PATCH', `/saas/bakeries/${a._id}`, { name: 'Staff overwrite', expectedVersion: 1 }, staffToken)).status, 403);
  await Membership.updateOne({ _id: member._id }, { $set: { active: false } });
  assert.equal((await api('GET', `/saas/bakeries/${a._id}/context`, undefined, staffToken)).status, 404);
  assert.deepEqual((await api('GET', '/saas/bakeries', undefined, staffToken)).bakeries, []);
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'suspended' } });
  assert.equal((await api('GET', `/saas/bakeries/${a._id}/context`)).status, 404);
  assert.deepEqual((await api('GET', '/saas/bakeries')).bakeries, []);
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'active' } });
});

test('profile changes are owner-only, version checked, exact-field validated and safe under concurrent edits', async () => {
  const path = `/saas/bakeries/${a._id}`;
  for (const body of [{ name: 'A' }, { name: '', expectedVersion: 1 }, { name: 'A', expectedVersion: '1' },
    { name: 'A', expectedVersion: 1, bakeryId: b._id }, { name: 'A', expectedVersion: 1, slug: 'stolen' },
    { name: 'A', expectedVersion: 1, role: 'owner' }]) {
    assert.equal((await api('PATCH', path, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await api('PATCH', path, { name: 'Other overwrite', expectedVersion: 1 }, otherToken)).status, 404);
  const updates = await Promise.all(['First rename', 'Second rename'].map(name => api('PATCH', path, { name, expectedVersion: 1 })));
  assert.deepEqual(updates.map(x => x.status).sort(), [200, 409]);
  assert.equal((await Bakery.findById(a._id)).version, 2);
  assert.equal((await Bakery.findById(b._id)).name, 'Bakery B');
  assert.equal((await api('PATCH', path, { name: 'Stale', expectedVersion: 1 })).status, 409);
  const form = await fetch(base + path, { method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Form&expectedVersion=2' });
  assert.equal(form.status, 415);
});

test('existing identity checks apply and bakery ownership cannot unlock legacy admin endpoints', async () => {
  for (const path of ['/admin/products', '/admin/orders', '/admin/settings']) {
    assert.equal((await api('GET', path)).status, 403);
  }
  await User.updateOne({ _id: owner._id }, { $set: { active: false } });
  assert.equal((await api('GET', '/saas/bakeries')).status, 403);
  await User.updateOne({ _id: owner._id }, { $set: { active: true, sessionVersion: 1 } });
  assert.equal((await api('GET', '/saas/bakeries')).status, 401);
  await User.updateOne({ _id: owner._id }, { $set: { sessionVersion: 0 } });
  assert.deepEqual(await Product.findById(legacy._id).lean(), legacy);
});

let productA, productB;
const productData = overrides => ({ name: 'Biscoff [9 pcs]', slug: 'biscoff', category: 'Cakes', pricePaise: 19900, stockCount: 9, ...overrides });
const productsPath = bakery => `/saas/bakeries/${bakery._id}/products`;

test('tenant catalogues allow independent identical slugs without touching or exposing legacy products', async () => {
  const first = await api('POST', productsPath(a), productData());
  assert.equal(first.status, 201, JSON.stringify(first)); productA = first.product;
  assert.equal(productA.pricePaise, 19900); assert.equal(productA.version, 1);
  assert.equal(productA.bakeryId, undefined); assert.equal(productA.schemaVersion, undefined);
  const second = await api('POST', productsPath(b), productData({ pricePaise: 24900 }), otherToken);
  assert.equal(second.status, 201); productB = second.product;
  assert.notEqual(productA._id, productB._id);
  assert.equal((await api('POST', productsPath(a), productData())).status, 409);
  assert.deepEqual((await api('GET', productsPath(a))).products.map(p => p._id), [productA._id]);
  assert.deepEqual((await api('GET', productsPath(b), undefined, otherToken)).products.map(p => p._id), [productB._id]);
  assert.equal((await api('GET', productsPath(a) + '/' + legacy._id)).status, 404);
  assert.equal(await Product.countDocuments(), 1);
  assert.deepEqual(await Product.findById(legacy._id).lean(), legacy);
});

test('product IDs, payloads and forged tenant headers never bypass bakery authorization', async () => {
  for (const [token, status] of [[null, 401], [otherToken, 404], [adminToken, 404]]) {
    assert.equal((await api('GET', productsPath(a), undefined, token)).status, status);
    assert.equal((await api('POST', productsPath(a), productData(), token)).status, status);
  }
  const path = productsPath(a) + '/' + productB._id;
  assert.equal((await api('GET', path, undefined, ownerToken, { 'X-Bakery-ID': b._id })).status, 404);
  assert.equal((await api('PATCH', path, { pricePaise: 0, expectedVersion: 1 })).status, 404);
  assert.equal((await api('GET', productsPath(a) + '/invalid')).status, 404);
  assert.equal((await api('PATCH', productsPath(a) + '/invalid', { archived: true, expectedVersion: 1 })).status, 404);
  assert.equal((await api('GET', productsPath(a) + '?bakeryId=' + b._id)).status, 400);
  assert.equal((await SaasProduct.findById(productB._id)).pricePaise, 24900);
  await Membership.updateOne({ bakeryId: a._id, userId: staff._id }, { $set: { active: true } });
  assert.equal((await api('GET', productsPath(a), undefined, staffToken)).status, 200);
  assert.equal((await api('POST', productsPath(a), productData(), staffToken)).status, 403);
  assert.equal((await api('PATCH', productsPath(a) + '/' + productA._id, { archived: true, expectedVersion: 1 }, staffToken)).status, 403);
});

test('product input rejects mass assignment, fractional paise, invalid stock and query injection', async () => {
  const invalid = [null, [], {}, productData({ bakeryId: b._id }), productData({ version: 8 }),
    productData({ schemaVersion: 8 }), productData({ pricePaise: 19.9 }), productData({ pricePaise: '19900' }),
    productData({ stockCount: 0.5 }), productData({ stockCount: -1 }), productData({ stockCount: 1000001 }),
    productData({ name: '' }), productData({ slug: { $ne: '' } }), productData({ slug: '-bad' }),
    productData({ available: 'true' }), productData({ pricePaise: 100000001 }), productData({ group: 'other' }),
    productData({ dietary: 'anything' }), productData({ category: 'a'.repeat(101) })];
  for (const body of invalid) assert.equal((await api('POST', productsPath(a), body)).status, 400, JSON.stringify(body));
  for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?limit[$gt]=0', '?search[$ne]=a',
    '?cursor=bad', '?archived=maybe', '?search=' + 'a'.repeat(101), '?limit=1&limit=2']) {
    assert.equal((await api('GET', productsPath(a) + query)).status, 400, query);
  }
  assert.equal((await api('POST', productsPath(a), productData(), ownerToken, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(await SaasProduct.countDocuments({ bakeryId: a._id }), 1);
});

test('product edits use version checks, preserve exact integer money, and archive only the selected bakery product', async () => {
  const path = productsPath(a) + '/' + productA._id;
  const updates = await Promise.all([21900, 22900].map(pricePaise => api('PATCH', path, { pricePaise, expectedVersion: 1 })));
  assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
  assert.equal((await api('PATCH', path, { pricePaise: 0, expectedVersion: 1 })).status, 409);
  const archived = await api('PATCH', path, { archived: true, expectedVersion: 2 });
  assert.equal(archived.status, 200); assert.equal(archived.product.version, 3);
  assert.equal((await api('GET', productsPath(a))).products.length, 0);
  assert.deepEqual((await api('GET', productsPath(a) + '?archived=archived')).products.map(p => p._id), [productA._id]);
  assert.equal((await api('GET', productsPath(b), undefined, otherToken)).products.length, 1);
  const restored = await api('PATCH', path, { archived: false, pricePaise: 0, stockCount: null, expectedVersion: 3 });
  assert.equal(restored.status, 200); assert.equal(restored.product.pricePaise, 0); assert.equal(restored.product.stockCount, null);
  for (const body of [{ expectedVersion: 4 }, { name: 'x' }, { name: 'x', expectedVersion: '4' }, { name: 'x', expectedVersion: 4, bakeryId: b._id }]) {
    assert.equal((await api('PATCH', path, body)).status, 400);
  }
});

test('product lists use literal search, bounded cursor pagination and stable tenant filters', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await api('POST', productsPath(a), productData({ name: `Cookie ${i}`, slug: `cookie-${i}` }))).status, 201);
  const first = await api('GET', productsPath(a) + '?limit=2');
  assert.equal(first.products.length, 2); assert.ok(first.nextCursor);
  const second = await api('GET', productsPath(a) + '?limit=2&cursor=' + first.nextCursor);
  assert.equal(second.products.length, 2); assert.ok(second.nextCursor);
  const last = await api('GET', productsPath(a) + '?limit=2&cursor=' + second.nextCursor);
  assert.equal(last.products.length, 1); assert.equal(last.nextCursor, null);
  const ids = [...first.products, ...second.products, ...last.products].map(p => p._id);
  assert.equal(new Set(ids).size, 5); assert.equal(ids.includes(productB._id), false);
  assert.equal((await api('GET', productsPath(a) + '?search=' + encodeURIComponent('[9 pcs]'))).products.length, 1);
  assert.equal((await api('GET', productsPath(a) + '?search=' + encodeURIComponent('.*'))).products.length, 0);
  assert.equal((await api('GET', productsPath(a) + '?search=cOoKiE')).products.length, 4);
});

test('transactional product writes reject stale owner context and roll back on failed saves', async () => {
  const context = { bakeryId: a._id, userId: String(owner._id), role: 'owner' };
  const before = (await SaasProduct.findById(productA._id)).toObject();
  await assert.rejects(() => ownerWrite(context, async session => {
    await SaasProduct.updateOne({ _id: productA._id, bakeryId: a._id }, { $set: { pricePaise: 123 } }, { session });
    throw new Error('Synthetic failed save');
  }), /Synthetic failed save/);
  assert.deepEqual((await SaasProduct.findById(productA._id)).toObject(), before);
  await Membership.updateOne({ bakeryId: a._id, userId: owner._id }, { $set: { active: false } });
  await assert.rejects(() => ownerWrite(context, () => { throw new Error('must not run'); }), error => error.statusCode === 403);
  await Membership.updateOne({ bakeryId: a._id, userId: owner._id }, { $set: { active: true } });
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'suspended' } });
  await assert.rejects(() => ownerWrite(context, () => { throw new Error('must not run'); }), error => error.statusCode === 404);
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'active' } });
  assert.deepEqual(await Product.findById(legacy._id).lean(), legacy);
});

test('security audit is scoped metadata and a failed audit rolls back the associated write', async () => {
  const rows = await SaasAuditLog.find({ bakeryId: a._id }).lean();
  for (const action of ['bakery.create', 'bakery.rename', 'product.create', 'product.update', 'product.archive', 'product.restore']) {
    assert.ok(rows.some(row => row.action === action), action);
  }
  assert.ok(rows.every(row => String(row.actorId) === String(owner._id)));
  assert.ok(!JSON.stringify(rows).includes('Biscoff'));
  assert.ok(rows.every(row => row.toVersion > row.fromVersion && row.fields.length > 0));
  const prior = await SaasAuditLog.countDocuments();
  const create = SaasAuditLog.create;
  SaasAuditLog.create = async () => { throw new Error('Synthetic audit failure'); };
  try {
    const result = await api('POST', productsPath(a), productData({ slug: 'audit-failure' }));
    assert.equal(result.status, 500);
  } finally { SaasAuditLog.create = create; }
  assert.equal(await SaasProduct.countDocuments({ slug: 'audit-failure' }), 0);
  assert.equal(await SaasAuditLog.countDocuments(), prior);
});

const materialsPath = bakery => `/saas/bakeries/${bakery._id}/materials`;
const recipesPath = bakery => `/saas/bakeries/${bakery._id}/recipes`;
let flour, oven, foreignMaterial, family, originalRevision, secondRevision, foreignRevision;
const materialData = overrides => ({ name: 'Flour', packQuantity: '1000', packUom: 'g', purchasePricePaise: 10000, ...overrides });
const formula = overrides => ({ yieldPieces: 8, label: '8 pieces', overheadPaise: 400,
  ingredients: [{ materialId: flour._id, expectedVersion: flour.version, quantity: '200', uom: 'g' },
    { materialId: oven._id, expectedVersion: oven.version, quantity: '16', uom: 'minute' }], ...overrides });

test('tenant materials keep pack pricing private to owners and reject invalid prices and cross-bakery writes', async () => {
  for (const [token, status] of [[null, 401], [staffToken, 403], [otherToken, 404], [adminToken, 404]]) {
    assert.equal((await api('GET', materialsPath(a), undefined, token)).status, status);
    assert.equal((await api('POST', materialsPath(a), materialData(), token)).status, status);
  }
  const first = await api('POST', materialsPath(a), materialData()); assert.equal(first.status, 201); flour = first.material;
  const heat = await api('POST', materialsPath(a), materialData({ name: 'Oven', type: 'resource', packQuantity: '16', packUom: 'minute', purchasePricePaise: 1600 }));
  assert.equal(heat.status, 201); oven = heat.material;
  const otherMaterial = await api('POST', materialsPath(b), materialData(), otherToken);
  assert.equal(otherMaterial.status, 201); foreignMaterial = otherMaterial.material;
  for (const patch of [{ purchasePricePaise: '100' }, { packQuantity: '0' }, { packQuantity: '1e3' }, { packUom: 'unknown' },
    { bakeryId: b._id }, { version: 10 }, { active: null }]) {
    assert.equal((await api('POST', materialsPath(a), materialData(patch))).status, 400);
  }
  assert.equal((await api('PATCH', materialsPath(a) + '/' + foreignMaterial._id, { purchasePricePaise: 0, expectedVersion: 1 })).status, 404);
  assert.equal((await api('GET', materialsPath(a) + '?limit=1')).items.length, 1);
  assert.equal((await api('GET', materialsPath(a))).items.length, 2);
});

test('recipe families create authoritative immutable revision costs, never trusting client costing or foreign materials', async () => {
  assert.equal((await api('GET', recipesPath(a), undefined, staffToken)).status, 403);
  const body = { name: 'Biscoff', category: 'Cakes', ...formula() };
  assert.equal((await api('POST', recipesPath(a), { ...body, batchCostPaise: '1' })).status, 400);
  const bad = structuredClone(body); bad.ingredients[0].materialId = foreignMaterial._id;
  const before = await SaasRecipe.countDocuments();
  assert.equal((await api('POST', recipesPath(a), bad)).status, 404);
  assert.equal(await SaasRecipe.countDocuments(), before);
  assert.equal(await SaasRecipeRevision.countDocuments(), 0);
  const created = await api('POST', recipesPath(a), body); assert.equal(created.status, 201, JSON.stringify(created));
  family = created.recipe; originalRevision = created.revision;
  assert.equal(originalRevision.batchCostPaise, '4000'); assert.equal(originalRevision.unitCostPaise, '500');
  assert.equal(originalRevision.ingredients[1].costPaise, '1600');
  assert.equal(originalRevision.ingredients[0].purchasePricePaise, 10000);
  assert.equal(originalRevision.revisionNumber, 1);
  assert.equal((await SaasRecipeRevision.findById(originalRevision._id)).validateSync(), undefined);
  const foreign = await api('POST', recipesPath(b), { name: 'Biscoff', category: 'Cakes', yieldPieces: 9,
    ingredients: [{ materialId: foreignMaterial._id, expectedVersion: 1, quantity: '200', uom: 'g' }] }, otherToken);
  assert.equal(foreign.status, 201); foreignRevision = foreign.revision;
  assert.equal((await api('GET', recipesPath(a) + '/' + foreign.recipe._id)).status, 404);
});

test('material price edits affect new revisions only and stale material/family versions cannot silently save', async () => {
  const saved = await SaasRecipeRevision.findById(originalRevision._id).lean();
  const changed = await api('PATCH', materialsPath(a) + '/' + flour._id, { purchasePricePaise: 20000, expectedVersion: 1 });
  assert.equal(changed.status, 200);
  assert.equal((await api('POST', recipesPath(a) + '/' + family._id + '/revisions', { ...formula(), expectedVersion: 1 })).status, 409);
  flour = changed.material;
  const revision = await api('POST', recipesPath(a) + '/' + family._id + '/revisions', { ...formula({ yieldPieces: 9, label: '9 pieces' }), expectedVersion: family.version });
  assert.equal(revision.status, 201, JSON.stringify(revision)); family = revision.recipe; secondRevision = revision.revision;
  assert.equal(secondRevision.batchCostPaise, '6000'); assert.equal(secondRevision.revisionNumber, 2);
  assert.equal(secondRevision.ingredients[0].materialVersion, 2);
  assert.deepEqual(await SaasRecipeRevision.findById(originalRevision._id).lean(), saved);
  assert.equal((await api('PATCH', recipesPath(a) + '/' + family._id, { name: 'Stale', expectedVersion: 1 })).status, 409);
  const concurrent = await Promise.all([1, 2].map(() => api('POST', recipesPath(a) + '/' + family._id + '/revisions', { ...formula(), expectedVersion: family.version })));
  assert.deepEqual(concurrent.map(row => row.status).sort(), [201, 409]); family = concurrent.find(row => row.status === 201).recipe;
  const latest = await api('GET', recipesPath(a) + '/' + family._id + '?limit=1');
  assert.equal(latest.revisions[0].revisionNumber, 3); assert.equal(latest.nextBefore, 3);
  const previous = await api('GET', recipesPath(a) + '/' + family._id + '?limit=1&before=3');
  assert.equal(previous.revisions[0].revisionNumber, 2); assert.equal(previous.nextBefore, 2);
});

test('product mapping switches exactly one revision with tenant checks and does not rewrite any revision snapshot', async () => {
  const path = productsPath(a) + '/' + productA._id, mapping = path + '/recipe-mapping';
  let current = (await api('GET', path)).product;
  const versions = await SaasRecipeRevision.find({ bakeryId: a._id }).sort({ _id: 1 }).lean();
  assert.equal((await SaasProduct.findById(productA._id).lean()).schemaVersion, 1);
  assert.equal((await api('PATCH', mapping, { revisionId: foreignRevision._id, expectedVersion: current.version })).status, 404);
  assert.equal((await api('PATCH', path, { recipeRevisionId: originalRevision._id, expectedVersion: current.version })).status, 400);
  const first = await api('PATCH', mapping, { revisionId: originalRevision._id, expectedVersion: current.version });
  assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.product.recipeRevisionId, originalRevision._id);
  assert.equal((await api('PATCH', mapping, { revisionId: secondRevision._id, expectedVersion: current.version })).status, 409);
  const second = await api('PATCH', mapping, { revisionId: secondRevision._id, expectedVersion: first.product.version });
  assert.equal(second.status, 200); assert.equal(second.product.recipeRevisionId, secondRevision._id);
  assert.equal(second.product.recipeId, family._id);
  const fresh = (await api('GET', path)).product;
  assert.equal(fresh.pricePaise, current.pricePaise); assert.equal(fresh.recipeRevisionId, secondRevision._id);
  assert.equal((await api('PATCH', recipesPath(a) + '/' + family._id, { archived: true, expectedVersion: family.version })).status, 409);
  assert.deepEqual(await SaasRecipeRevision.find({ bakeryId: a._id }).sort({ _id: 1 }).lean(), versions);
  const archived = await api('PATCH', path, { archived: true, expectedVersion: fresh.version });
  assert.equal(archived.status, 200);
  const unmapped = await api('PATCH', mapping, { revisionId: null, expectedVersion: archived.product.version });
  assert.equal(unmapped.status, 200); assert.equal(unmapped.product.recipeId, null); assert.equal(unmapped.product.recipeRevisionId, null);
  const hidden = await api('PATCH', recipesPath(a) + '/' + family._id, { archived: true, expectedVersion: family.version });
  assert.equal(hidden.status, 200); family = hidden.recipe;
  assert.equal((await api('POST', recipesPath(a) + '/' + family._id + '/revisions', { ...formula(), expectedVersion: family.version })).status, 409);
  assert.equal((await api('GET', recipesPath(a))).items.length, 0);
  assert.equal((await api('GET', recipesPath(a) + '?archived=archived')).items.length, 1);
  assert.equal((await api('DELETE', recipesPath(a) + '/' + family._id + '/revisions/' + originalRevision._id)).status, 404);
});

test('storefront settings are owner-only, version checked and private until an explicit preview enablement', async () => {
  const path = `/saas/bakeries/${a._id}/storefront-settings`;
  assert.equal((await api('GET', '/saas/storefront/bakery-a', undefined, null)).status, 404);
  assert.equal((await api('GET', path, undefined, staffToken)).status, 403);
  assert.equal((await api('PATCH', path, { published: true, expectedVersion: 0 }, otherToken)).status, 404);
  const initial = await api('GET', path); assert.equal(initial.settings.version, 0); assert.equal(initial.settings.published, false);
  for (const payload of [{ published: 'true', expectedVersion: 0 }, { contactPhone: 'javascript:1', expectedVersion: 0 },
    { contactEmail: 'bad', expectedVersion: 0 }, { bakeryId: b._id, expectedVersion: 0 }, { published: true }]) {
    assert.equal((await api('PATCH', path, payload)).status, 400);
  }
  const drafts = await api('PATCH', path, { tagline: 'A private draft', contactEmail: 'demo@example.test', expectedVersion: 0 });
  assert.equal(drafts.status, 200); assert.equal(drafts.settings.version, 1);
  assert.equal((await api('GET', '/saas/storefront/bakery-a', undefined, null)).status, 404);
  assert.equal((await api('PATCH', path, { published: true, expectedVersion: 0 })).status, 409);
  const enabled = await api('PATCH', path, { published: true, expectedVersion: 1 });
  assert.equal(enabled.status, 200); assert.equal(enabled.settings.version, 2);
});

test('anonymous menu previews expose only the resolved bakery catalogue and public profile fields', async () => {
  const visible = await api('GET', '/saas/storefront/bakery-a?limit=2', undefined, null);
  assert.equal(visible.status, 200); assert.equal(visible.bakery.slug, 'bakery-a'); assert.equal(visible.products.length, 2);
  assert.equal(visible.profile.contactEmail, 'demo@example.test'); assert.ok(visible.nextCursor);
  for (const product of visible.products) {
    for (const field of ['stockCount', 'version', 'recipeId', 'recipeRevisionId', 'bakeryId', 'costSnapshot']) assert.equal(product[field], undefined);
    assert.notEqual(product.id, productB._id); assert.notEqual(product.id, String(legacy._id)); assert.notEqual(product.id, productA._id);
  }
  assert.equal(visible.bakery._id, undefined); assert.equal(visible.bakery.createdBy, undefined);
  assert.equal((await api('GET', '/saas/storefront/bakery-b', undefined, null)).status, 404);
  assert.equal((await api('GET', '/saas/storefront/unknown-bakery', undefined, null)).status, 404);
  assert.equal((await api('GET', '/saas/storefront/bakery-a?bakeryId=' + b._id, undefined, null)).status, 400);
  await api('PATCH', `/saas/bakeries/${b._id}/storefront-settings`, { published: true, expectedVersion: 0 }, otherToken);
  const other = await api('GET', '/saas/storefront/bakery-b', undefined, null, { 'X-Bakery-ID': a._id });
  assert.equal(other.status, 200); assert.deepEqual(other.products.map(row => row.id), [productB._id]);
});

test('preview availability follows stock without publishing quantities and is revoked on disablement or suspension', async () => {
  const available = (await api('GET', productsPath(a))).products[0];
  const hidden = await api('PATCH', productsPath(a) + '/' + available._id, { stockCount: 0, expectedVersion: available.version });
  assert.equal(hidden.status, 200);
  let menu = await api('GET', '/saas/storefront/bakery-a', undefined, null);
  assert.equal(menu.products.some(row => row.id === available._id), false);
  const settings = `/saas/bakeries/${a._id}/storefront-settings`;
  assert.equal((await api('PATCH', settings, { showUnavailable: true, expectedVersion: 2 })).status, 200);
  menu = await api('GET', '/saas/storefront/bakery-a', undefined, null);
  const soldOut = menu.products.find(row => row.id === available._id);
  assert.equal(soldOut.available, false); assert.equal(soldOut.stockCount, undefined);
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'suspended' } });
  assert.equal((await api('GET', '/saas/storefront/bakery-a', undefined, null)).status, 404);
  await Bakery.updateOne({ _id: a._id }, { $set: { status: 'active' } });
  assert.equal((await api('PATCH', settings, { published: false, expectedVersion: 3 })).status, 200);
  assert.equal((await api('GET', '/saas/storefront/bakery-a', undefined, null)).status, 404);
  assert.deepEqual(await Product.findById(legacy._id).lean(), legacy);
});

test('brand settings remain tenant scoped, reject CSS/HTML inputs and require a fresh owner-reviewed version', async () => {
  const first = (await api('POST', '/saas/bakeries', { name: 'Brand A', slug: 'brand-a' })).bakery;
  const second = (await api('POST', '/saas/bakeries', { name: 'Brand B', slug: 'brand-b' }, otherToken)).bakery;
  const settings = `/saas/bakeries/${first._id}/storefront-settings`;
  assert.equal((await api('GET', settings)).settings.brandTheme, 'gold');
  for (const fields of [{ brandTheme: 'url(https://untrusted.test)' }, { brandTheme: '#fff' }, { brandMark: '<svg>' }, { brandMark: 'TOOLONG' }, { brandTheme: { gold: true } }, { logoUrl: 'https://untrusted.test/a.png' }]) {
    assert.equal((await api('PATCH', settings, { ...fields, expectedVersion: 0 })).status, 400);
  }
  assert.equal((await api('PATCH', settings, { brandTheme: 'sage', expectedVersion: 0 }, otherToken)).status, 404);
  const saved = await api('PATCH', settings, { brandTheme: 'rose', brandMark: 'gb', published: true, expectedVersion: 0 }); assert.equal(saved.status, 200); assert.equal(saved.settings.brandMark, 'GB');
  assert.equal((await api('PATCH', settings, { brandTheme: 'sage', expectedVersion: 0 })).status, 409);
  await api('PATCH', `/saas/bakeries/${second._id}/storefront-settings`, { brandTheme: 'sage', brandMark: 'B2', published: true, expectedVersion: 0 }, otherToken);
  const firstMenu = await api('GET', '/saas/storefront/brand-a', undefined, null, { 'X-Bakery-ID': second._id });
  const secondMenu = await api('GET', '/saas/storefront/brand-b', undefined, null);
  assert.equal(firstMenu.profile.brandTheme, 'rose'); assert.equal(firstMenu.profile.brandMark, 'GB'); assert.equal(secondMenu.profile.brandTheme, 'sage'); assert.equal(secondMenu.profile.brandMark, 'B2'); assert.equal(firstMenu.profile.version, undefined); assert.equal(firstMenu.profile.bakeryId, undefined);
  const Storefront = require('../src/models/SaasStorefront'); await Storefront.collection.updateOne({ bakeryId: new mongoose.Types.ObjectId(first._id) }, { $unset: { brandTheme: '', brandMark: '' } });
  const fallback = await api('GET', '/saas/storefront/brand-a', undefined, null); assert.equal(fallback.profile.brandTheme, 'gold'); assert.equal(fallback.profile.brandMark, '');
  assert.equal((await api('GET', settings)).settings.brandTheme, 'gold'); assert.equal((await Storefront.collection.findOne({ bakeryId: new mongoose.Types.ObjectId(first._id) })).brandTheme, undefined);
});

test('canonical local links use verified bakery context and a configured origin, ignoring forwarded Host',async()=>{
 const path=`/saas/bakeries/${a._id}/storefront-link`,previous=process.env.SAAS_LOCAL_PUBLIC_ORIGIN;process.env.SAAS_LOCAL_PUBLIC_ORIGIN='http://localhost:4200';
 try{
  const result=await api('GET',path,undefined,ownerToken,{'X-Forwarded-Host':'attacker.test',Forwarded:'host=attacker.test;proto=https'});assert.equal(result.status,200);assert.equal(result.link.url,'http://localhost:4200/b/bakery-a');assert.equal(result.link.scope,'local-preview');
  assert.equal((await api('GET',path,undefined,staffToken)).status,403);assert.equal((await api('GET',path,undefined,otherToken)).status,404);assert.equal((await api('GET',path+'?origin=https://attacker.test')).status,400);
  const status=await new Promise((resolve,reject)=>{const request=require('node:http').get(base+path,{headers:{Host:'attacker.test',Authorization:`Bearer ${ownerToken}`}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);});assert.equal(status,404);
  process.env.SAAS_LOCAL_PUBLIC_ORIGIN='https://production.test';assert.equal((await api('GET',path)).status,503);
 }finally{if(previous===undefined)delete process.env.SAAS_LOCAL_PUBLIC_ORIGIN;else process.env.SAAS_LOCAL_PUBLIC_ORIGIN=previous;}
});
