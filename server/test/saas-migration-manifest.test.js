const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planMigration, SOURCE_MODELS } = require('../src/saas/migration-manifest');
const bakery = '100000000000000000000001';
const id = n => n.toString(16).padStart(24, '0');
const fixture = () => ({ formatVersion: 1, collections: Object.fromEntries(SOURCE_MODELS.map(name => [name, []])) });

test('offline plan covers all legacy models, excludes sessions and never allows apply', () => {
  const source = fixture();
  source.collections.Product.push({ _id: id(1), slug: 'cake', price: 199 });
  source.collections.StoreSettings.push({ _id: 'store', upi: { private: 'not-in-output' } });
  source.collections.User.push({ _id: id(2), email: 'private@example.test' });
  source.collections.Otp.push({ _id: id(3), code: '123456' });
  const before = JSON.stringify(source);
  const result = planMigration(source, bakery);
  assert.equal(result.status, 'ready-for-manual-review');
  assert.equal(result.canApply, false);
  assert.equal(result.collections.length, 28);
  assert.equal(result.collections.find(c => c.model === 'Product').scope, 'tenant-review');
  assert.equal(result.collections.find(c => c.model === 'User').scope, 'manual-review');
  assert.equal(result.collections.find(c => c.model === 'Otp').scope, 'exclude');
  assert.equal(JSON.stringify(source), before);
  const output = JSON.stringify(result);
  for (const secret of ['not-in-output', 'private@example.test', '123456', '199']) assert.equal(output.includes(secret), false);
  assert.equal(result.sourceDigest.length, 64);
});

test('unknown, missing, malformed collections and duplicate or malformed IDs block the plan', () => {
  const source = fixture(); delete source.collections.Payment;
  source.collections.Extra = []; source.collections.Coupon = {};
  source.collections.Product = [{ _id: id(1) }, { _id: id(1) }, { _id: 'bad' }, null];
  const result = planMigration(source, bakery);
  assert.equal(result.status, 'blocked');
  for (const code of ['MISSING_MODEL', 'UNKNOWN_MODEL', 'INVALID_COLLECTION', 'DUPLICATE_ID', 'INVALID_RECORD_ID']) {
    assert.ok(result.blockers.some(row => row.code === code), code);
  }
});

test('tenant conflicts are blocked; same bakery IDs and extended JSON ObjectIds are recognized', () => {
  const source = fixture();
  source.collections.Product = [{ _id: { $oid: id(1) }, bakeryId: { $oid: bakery }, tenantId: bakery }];
  assert.deepEqual(planMigration(source, bakery).blockers, []);
  for (const value of [null, id(8), { $ne: bakery }]) {
    source.collections.Product[0].bakeryId = value;
    assert.ok(planMigration(source, bakery).blockers.some(row => row.code === 'TENANT_CONFLICT'));
  }
});

test('active references block while dangling historical references warn without recalculating snapshots', () => {
  const source = fixture();
  source.collections.Order = [{ _id: id(1), items: [{ product: id(99), price: 0, quantity: 2 }],
    pricing: { total: 0, discount: 398 }, recipeCostSnapshot: [{ recipeId: id(98), unitCost: { $numberDecimal: '62.1800' } }] }];
  source.collections.Payment = [{ _id: id(2), order: id(1), amount: 0, razorpayOrderIds: ['old-provider-id'] }];
  const before = JSON.stringify(source);
  const first = planMigration(source, bakery);
  assert.equal(first.status, 'ready-for-manual-review');
  assert.equal(first.warnings.length, 2); assert.equal(first.checkedReferences, 3);
  source.collections.Payment[0].order = id(77);
  assert.ok(planMigration(source, bakery).blockers.some(row => row.code === 'REFERENCE_MISSING'));
  source.collections.Payment[0].order = id(1);
  assert.equal(JSON.stringify(source), before);
  source.collections.Order[0].recipeCostSnapshot[0].unitCost.$numberDecimal = '62.18';
  const changed = planMigration(source, bakery);
  assert.notEqual(changed.sourceDigest, first.sourceDigest);
  assert.notEqual(changed.collections.find(c => c.model === 'Order').documents[0].sourceDigest,
    first.collections.find(c => c.model === 'Order').documents[0].sourceDigest);
});

test('nested optional recipe references and unique keys are checked without printing their values', () => {
  const source = fixture();
  source.collections.BakeryRecipe = [{ _id: id(1), productId: id(5), options: [{ components: [{ materialId: id(6) }] }] },
    { _id: id(2), productId: id(5) }];
  source.collections.Product = [{ _id: id(5), slug: 'private-slug' }, { _id: id(7), slug: 'private-slug' }];
  const result = planMigration(source, bakery);
  assert.ok(result.blockers.some(row => row.path === 'options.*.components.*.materialId'));
  assert.ok(result.blockers.some(row => row.code === 'UNIQUE_KEY_COLLISION' && row.model === 'BakeryRecipe'));
  assert.ok(result.blockers.some(row => row.code === 'UNIQUE_KEY_COLLISION' && row.model === 'Product'));
  assert.equal(JSON.stringify(result).includes('private-slug'), false);
});

test('manifest is deterministic across object key order and collection row order has stable per-collection checksums', () => {
  const source = fixture(); source.collections.Product = [{ _id: id(1), slug: 'one' }, { _id: id(2), slug: 'two' }];
  const first = planMigration(source, bakery);
  const reordered = { collections: Object.fromEntries(Object.entries(source.collections).reverse()), formatVersion: 1 };
  assert.deepEqual(planMigration(reordered, bakery), first);
  source.collections.Product.reverse();
  assert.deepEqual(planMigration(source, bakery).collections, first.collections);
});

test('non-JSON, circular, non-finite and unsafe input formats are rejected', () => {
  for (const source of [null, [], { formatVersion: 2, collections: {} }, { ...fixture(), apply: true }]) {
    assert.throws(() => planMigration(source, bakery), TypeError);
  }
  for (const value of [Infinity, NaN, undefined, new Date(), () => null]) {
    const source = fixture(); source.collections.Product = [{ _id: id(1), value }];
    assert.throws(() => planMigration(source, bakery), TypeError);
  }
  const cyclic = fixture(); cyclic.collections.Product = [cyclic];
  assert.throws(() => planMigration(cyclic, bakery), /cycle/);
  for (const value of ['', id(1) + 'x', { $ne: null }]) assert.throws(() => planMigration(fixture(), value));
});

test('CLI reads files without loading database code and refuses overwrites, symlinks and apply flags', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-manifest-'));
  try {
    const input = path.join(directory, 'fixture.json'), output = path.join(directory, 'manifest.json');
    fs.writeFileSync(input, JSON.stringify(fixture()));
    const cli = path.join(__dirname, '../src/utils/plan-saas-migration.js');
    const run = args => spawnSync(process.execPath, [cli, '--input', input, '--bakery-id', bakery, ...args],
      { encoding: 'utf8', env: { ...process.env, MONGODB_URI: 'mongodb://production.invalid/never-connect' }, timeout: 5000 });
    assert.equal(run(['--output', output]).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(output)).canApply, false);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.equal(run(['--output', output]).status, 1);
    assert.equal(run(['--output', input]).status, 1);
    assert.equal(run(['--apply', 'true']).status, 1);
    const link = path.join(directory, 'link.json'); fs.symlinkSync(input, link);
    assert.equal(run(['--output', link]).status, 1);
    const blocked = fixture(); delete blocked.collections.Product;
    fs.writeFileSync(input, JSON.stringify(blocked));
    const result = run([]);
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).status, 'blocked');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
