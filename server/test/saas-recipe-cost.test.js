const { test } = require('node:test');
const assert = require('node:assert/strict');
const { materialInput, revisionInput, costRevision } = require('../src/saas/recipe-input');
const materialId = '100000000000000000000001';
const material = { _id: materialId, name: 'Flour', type: 'ingredient', packQuantity: '1000', packUom: 'g', purchasePricePaise: 10000, active: true, version: 1 };
const input = extra => revisionInput({ yieldPieces: 8, ingredients: [{ materialId, expectedVersion: 1, quantity: '200', uom: 'g' }], ...extra });

test('pack costing uses exact decimal quantities and correct dimension conversions', () => {
  const materials = new Map([[materialId, material]]);
  const result = costRevision(input({ ingredients: [{ materialId, expectedVersion: 1, quantity: '1.25', uom: 'kg' }] }), materials);
  assert.equal(result.batchCostPaise, '12500'); assert.equal(result.unitCostPaise, '1562.5');
  const tiny = costRevision(input({ ingredients: [{ materialId, expectedVersion: 1, quantity: '0.001', uom: 'g' }] }), materials);
  assert.equal(tiny.batchCostPaise, '0.01'); assert.equal(tiny.unitCostPaise, '0.00125');
  assert.equal(material.purchasePricePaise, 10000);
});

test('a 16-minute oven pack prices 50 minutes as 50 minutes, with no implied cycle multiplier', () => {
  const materials = new Map([[materialId, { ...material, packQuantity: '16', packUom: 'minute', purchasePricePaise: 1600, type: 'resource' }]]);
  const result = costRevision(input({ ingredients: [{ materialId, expectedVersion: 1, quantity: '50', uom: 'minute' }] }), materials);
  assert.equal(result.batchCostPaise, '5000'); assert.equal(result.ingredients[0].quantity, '50');
  const hour = costRevision(input({ ingredients: [{ materialId, expectedVersion: 1, quantity: '1', uom: 'hour' }] }), materials);
  assert.equal(hour.batchCostPaise, '6000');
});

test('quantity strings are bounded and cost overrides or incompatible dimensions are rejected', () => {
  for (const quantity of ['0', '-1', '1e3', '1.0000001', '1000000001', 1]) {
    assert.throws(() => input({ ingredients: [{ materialId, expectedVersion: 1, quantity, uom: 'g' }] }));
  }
  assert.throws(() => input({ batchCostPaise: '0' }));
  assert.throws(() => input({ yieldPieces: 0 }));
  assert.throws(() => input({ ingredients: [] }));
  assert.throws(() => input({ ingredients: Array.from({ length: 101 }, () => ({ materialId })) }));
  assert.throws(() => costRevision(input({ ingredients: [{ materialId, expectedVersion: 1, quantity: '1', uom: 'ml' }] }), new Map([[materialId, material]])), /Cannot convert/);
});

test('stale, missing and inactive material records cannot become new snapshots', () => {
  assert.throws(() => costRevision(input(), new Map()), error => error.statusCode === 404);
  assert.throws(() => costRevision(input(), new Map([[materialId, { ...material, active: false }]])), error => error.statusCode === 404);
  assert.throws(() => costRevision(input(), new Map([[materialId, { ...material, version: 2 }]])), error => error.statusCode === 409);
  const parsed = materialInput({ name: ' Oven ', packQuantity: '16.000000', packUom: 'minute', purchasePricePaise: 1600 });
  assert.equal(parsed.packQuantity, '16'); assert.equal(parsed.name, 'Oven');
});
