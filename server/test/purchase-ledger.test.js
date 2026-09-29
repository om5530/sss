process.env.NODE_ENV = 'test';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Material = require('../src/models/BakeryMaterial');
const O = require('../src/models/BakeryOperations');
const ledger = require('../src/services/purchase-ledger.service');
let db, server, base, token, customerToken, flour, boxes;
async function api(method, path, body, auth = token) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) };
}
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  const User = require('../src/models/User');
  const sign = require('../src/services/token.service').signToken;
  token = sign(await User.create({ name: 'Purchase staff', role: 'admin' }));
  customerToken = sign(await User.create({ name: 'Customer', role: 'customer' }));
  for (const model of Object.values(O)) await model.init();
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/admin/bakery`;
});
beforeEach(async () => {
  await Promise.all([Material.deleteMany({}), ...Object.values(O).map(model => model.deleteMany({}))]);
  flour = (await api('POST', '/materials', { name: 'Flour', packQuantity: '1', packUom: 'kg', baseUom: 'g', purchasePrice: '50', currentStock: '100' })).material;
  boxes = (await api('POST', '/materials', { name: 'Boxes', type: 'packaging', packQuantity: '1', packUom: 'piece', baseUom: 'piece', purchasePrice: '10', currentStock: '3' })).material;
});
after(async () => {
  await new Promise(resolve => server?.close(resolve));
  await mongoose.disconnect();
  await db?.stop();
});
function payload(overrides = {}) {
  return { operationKey: 'purchase-record-test', purchasedAt: ledger.indiaDay(), supplierName: '', notes: 'Bill 42', lines: [
    { materialId: flour._id, quantity: '2', uom: 'kg', totalPaid: '110.25' },
    { materialId: boxes._id, quantity: '1', uom: 'dozen', totalPaid: '120.10' },
  ], ...overrides };
}

test('direct purchase is admin-only and atomically records inventory, history and precise spending', async () => {
  assert.equal((await api('POST', '/purchases/record', payload(), null)).status, 401);
  assert.equal((await api('POST', '/purchases/record', payload(), customerToken)).status, 403);
  assert.equal((await api('GET', '/purchase-history', undefined, customerToken)).status, 403);
  const result = await api('POST', '/purchases/record', payload());
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.purchase.status, 'received');
  assert.equal(result.purchase.source, 'direct');
  assert.equal((await Material.findById(flour._id)).currentStock, '2100');
  assert.equal((await Material.findById(boxes._id)).currentStock, '15');
  assert.equal(await O.Movement.countDocuments({ type: 'receipt' }), 2);
  const inventory = await api('GET', '/inventory');
  assert.equal(inventory.materials.find(m => m._id === flour._id).currentStock, '2100');
  const history = await api('GET', '/purchase-history');
  assert.equal(history.total, 1);
  assert.equal(history.summary.allTime, '230.35');
  assert.equal(history.summary.thisMonth, '230.35');
  assert.equal(history.summary.thisYear, '230.35');
  assert.equal(history.purchases[0].totalPaid, '230.35');
  assert.equal(history.purchases[0].lines[0].quantity, '2');
  assert.equal(history.purchases[0].lines[0].uom, 'kg');
  await Material.updateOne({ _id: flour._id }, { $set: { name: 'Renamed flour' } });
  assert.equal((await api('GET', '/purchase-history')).purchases[0].lines[0].materialName, 'Flour');
});

test('concurrent retries record one purchase and cannot reuse a saved key for changed details', async () => {
  const data = payload();
  const results = await Promise.all([api('POST', '/purchases/record', data), api('POST', '/purchases/record', data)]);
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(results[0].receipt._id, results[1].receipt._id);
  assert.equal(await O.Receipt.countDocuments(), 1);
  assert.equal(await O.Purchase.countDocuments(), 1);
  assert.equal((await Material.findById(flour._id)).currentStock, '2100');
  assert.equal((await api('POST', '/purchases/record', { ...data, notes: 'Changed bill' })).status, 409);
  assert.equal((await Material.findById(flour._id)).currentStock, '2100');
});

test('invalid input and inactive or incompatible materials leave no purchase or stock changes', async () => {
  const valid = payload();
  for (const body of [
    { ...valid, lines: [] },
    { ...valid, purchasedAt: '2020-02-30' },
    { ...valid, purchasedAt: '2999-01-01' },
    { ...valid, lines: [valid.lines[0], { ...valid.lines[1], materialId: 'missing' }] },
    { ...valid, lines: [{ ...valid.lines[0], quantity: '0' }] },
    { ...valid, lines: [{ ...valid.lines[0], totalPaid: '-1' }] },
    { ...valid, lines: [{ ...valid.lines[0], totalPaid: '2.005' }] },
    { ...valid, lines: [valid.lines[0], { ...valid.lines[1], uom: 'kg' }] },
  ]) assert.equal((await api('POST', '/purchases/record', body)).status, 400);
  await Material.updateOne({ _id: boxes._id }, { $set: { isActive: false } });
  assert.equal((await api('POST', '/purchases/record', valid)).status, 400);
  assert.equal((await Material.findById(flour._id)).currentStock, '100');
  assert.equal(await O.Movement.countDocuments({ type: 'receipt' }), 0);
  assert.equal(await O.Purchase.countDocuments(), 0);
  assert.equal(await O.Receipt.countDocuments(), 0);
});

test('legacy partial receipts and direct purchases share monthly totals at Indian midnight', async () => {
  await api('POST', '/purchases/record', payload({ purchasedAt: '2020-01-31' }));
  const [p] = await O.Purchase.create([{ code: 'LEGACY', status: 'partially_received', lines: [] }]);
  await O.Receipt.create([
    { purchaseId: p._id, operationKey: 'legacy-jan', receivedAt: new Date('2020-01-31T18:29:59.999Z'), lines: [{ materialId: flour._id, packQuantity: '1', packUom: 'kg', packs: '2', purchasePrice: '50.20' }] },
    { purchaseId: p._id, operationKey: 'legacy-feb', receivedAt: new Date('2020-01-31T18:30:00.000Z'), lines: [{ materialId: flour._id, packQuantity: '1', packUom: 'kg', packs: '1', purchasePrice: '60.10' }] },
  ]);
  await O.Purchase.create({ code: 'UNRECEIVED', lines: [{ packs: '1000', purchasePrice: '99999' }], status: 'ordered' });
  const january = await api('GET', '/purchase-history?month=2020-01');
  assert.equal(january.total, 2);
  assert.equal(january.summary.selectedTotal, '330.75');
  assert.equal(january.summary.allTime, '390.85');
  assert.equal(january.summary.thisMonth, '0');
  const february = await api('GET', '/purchase-history?month=2020-02');
  assert.equal(february.total, 1);
  assert.equal(february.summary.selectedTotal, '60.1');
  assert.equal((await api('GET', '/purchase-history?month=2020-13')).status, 400);
  assert.equal((await api('GET', '/purchase-history?page=Infinity')).status, 400);
  const empty = await api('GET', '/purchase-history?month=2020-03');
  assert.equal(empty.total, 0);
  assert.equal(empty.summary.selectedTotal, '0');
});

test('month and year summaries use India dates and exact decimal arithmetic', () => {
  const months = [{ month: '2020-12', total: '0.1', count: 1 }, { month: '2021-01', total: '0.2', count: 1 }];
  const totals = ledger.summarizeMonths(months, '2020-12', new Date('2020-12-31T18:30:00Z'));
  assert.equal(totals.allTime, '0.3');
  assert.equal(totals.thisMonth, '0.2');
  assert.equal(totals.thisYear, '0.2');
  assert.equal(totals.selectedTotal, '0.1');
  assert.equal(ledger.monthRange('2021-01').$gte.toISOString(), '2020-12-31T18:30:00.000Z');
});
