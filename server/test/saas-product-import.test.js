const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/saas-legacy-synthetic.json');
const { previewProductImport, reconcileProductImport } = require('../src/saas/product-import-preview');
const bakeryId = '100000000000000000000001';
const source = () => structuredClone(fixture);

test('product import preview converts exact prices without altering discounted orders, costs, recipe revisions or payments', () => {
  const snapshot = source(), before = JSON.stringify(snapshot);
  const result = previewProductImport(snapshot, bakeryId);
  assert.equal(result.canApply, false); assert.equal(result.status, 'ready-for-manual-review');
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].document.pricePaise, 19900);
  assert.equal(result.candidates[0].document._id, snapshot.collections.Product[0]._id);
  assert.equal(result.candidates[0].document.bakeryId, bakeryId);
  assert.ok(result.warnings.some(row => row.code === 'CATEGORY_REFERENCE_REQUIRES_IMPORT_POLICY'));
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(Object.keys(require.cache).some(path => path.includes('/src/models/')), false);
});

test('product import never silently rounds money or exceeds target price limits', () => {
  for (const [price, expected] of [[0, 0], [0.1, 10], [12.88, 1288], ['199.00', 19900],
    [{ $numberDecimal: '62.18' }, 6218], [{ $numberInt: '199' }, 19900], [1000000, 100000000]]) {
    const snapshot = source(); snapshot.collections.Product[0].price = price;
    const result = previewProductImport(snapshot, bakeryId);
    assert.equal(result.status, 'ready-for-manual-review'); assert.equal(result.candidates[0].document.pricePaise, expected);
  }
  for (const price of [1.005, 0.1 + 0.2, -1, null, '1e3', 1000000.01, { $numberDecimal: '0.001' }]) {
    const snapshot = source(); snapshot.collections.Product[0].price = price;
    const result = previewProductImport(snapshot, bakeryId);
    assert.equal(result.status, 'blocked', JSON.stringify(price)); assert.equal(result.candidates.length, 0);
  }
});

test('unsupported data, deleted records, null dietary/availability and custom fields require explicit review', () => {
  for (const patch of [{ image: 'https://example.test/cake.jpg' }, { tags: ['special'] }, { ratingAvg: 4 },
    { ratingCount: 2 }, { deletedAt: '2026-10-30T00:00:00Z' }, { available: null }, { dietary: null },
    { stockCount: 1.2 }, { customPrivateField: 'do-not-copy' }]) {
    const snapshot = source(); Object.assign(snapshot.collections.Product[0], patch);
    const result = previewProductImport(snapshot, bakeryId);
    assert.equal(result.status, 'blocked', JSON.stringify(patch)); assert.equal(result.candidates.length, 0);
    assert.equal(JSON.stringify(result).includes('do-not-copy'), false);
  }
  const snapshot = source(); Object.assign(snapshot.collections.Product[0], { archived: true, available: false, stockCount: 0 });
  const doc = previewProductImport(snapshot, bakeryId).candidates[0].document;
  assert.equal(doc.archived, true); assert.equal(doc.available, false); assert.equal(doc.stockCount, 0);
});

test('snapshot-level blockers prevent even otherwise valid product candidates', () => {
  const snapshot = source(); snapshot.collections.Payment[0].order = '000000000000000000000099';
  const result = previewProductImport(snapshot, bakeryId);
  assert.equal(result.status, 'blocked'); assert.equal(result.candidates.length, 0);
  assert.ok(result.blockers.some(row => row.code === 'REFERENCE_MISSING'));
});

test('reconciliation regenerates expectations from source and accepts exact target rows', () => {
  const snapshot = source();
  const target = previewProductImport(snapshot, bakeryId).candidates.map(row => ({ ...row.document, __v: 0, createdAt: '2026-10-30T00:00:00.000Z' }));
  const result = reconcileProductImport(snapshot, bakeryId, target);
  assert.equal(result.status, 'matched'); assert.equal(result.expectedCount, 1); assert.equal(result.targetCount, 1);
  assert.equal(result.canApply, false); assert.deepEqual(result.differences, []);
  snapshot.collections.Product[0].price = 219;
  const changed = reconcileProductImport(snapshot, bakeryId, target);
  assert.equal(changed.status, 'blocked');
  assert.deepEqual(changed.differences[0].fields, ['pricePaise']);
  assert.notEqual(changed.sourceDigest, result.sourceDigest);
});

test('reconciliation detects wrong tenants, lost fields, duplicates, extras and absent rows without proposing deletion', () => {
  const snapshot = source(), doc = previewProductImport(snapshot, bakeryId).candidates[0].document;
  const foreign = reconcileProductImport(snapshot, bakeryId, [{ ...doc, bakeryId: '200000000000000000000001' }]);
  assert.equal(foreign.differences[0].code, 'FOREIGN_TARGET_RECORD');
  const tampered = { ...doc, pricePaise: 1, customField: 'secret', name: undefined }; delete tampered.name;
  const changed = reconcileProductImport(snapshot, bakeryId, [tampered]);
  assert.deepEqual(changed.differences[0].fields, ['customField', 'name', 'pricePaise']);
  assert.equal(JSON.stringify(changed).includes('secret'), false);
  assert.ok(reconcileProductImport(snapshot, bakeryId, [doc, doc]).differences.some(row => row.code === 'DUPLICATE_TARGET_ID'));
  assert.ok(reconcileProductImport(snapshot, bakeryId, [{ ...doc, _id: '000000000000000000000098' }]).differences.some(row => row.code === 'UNEXPECTED_TARGET_RECORD'));
  assert.ok(reconcileProductImport(snapshot, bakeryId, []).differences.some(row => row.code === 'TARGET_PRODUCT_MISSING'));
});

test('UTC timestamps and canonical ObjectId/integer Extended JSON reconcile without losing source identity', () => {
  const snapshot = source(); Object.assign(snapshot.collections.Product[0], {
    createdAt: { $date: '2026-10-01T12:00:00Z' }, updatedAt: '2026-10-02T12:00:00.000Z',
  });
  const doc = previewProductImport(snapshot, bakeryId).candidates[0].document;
  assert.equal(doc.createdAt, '2026-10-01T12:00:00.000Z');
  const actual = { ...doc, _id: { $oid: doc._id }, bakeryId: { $oid: bakeryId }, pricePaise: { $numberInt: '19900' },
    version: { $numberInt: '1' }, createdAt: { $date: doc.createdAt } };
  assert.equal(reconcileProductImport(snapshot, bakeryId, [actual]).status, 'matched');
  snapshot.collections.Product[0].createdAt = '2026-02-31T12:00:00Z';
  assert.equal(previewProductImport(snapshot, bakeryId).status, 'blocked');
});
