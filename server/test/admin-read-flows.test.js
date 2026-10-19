process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const O = require('../src/models/BakeryOperations');
const Material = require('../src/models/BakeryMaterial');
const EventPlan = require('../src/models/EventPlan');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const { maps } = require('../src/services/bakery-context.service');
let database, server, base, adminToken, customerToken;

async function api(method, path, body, token = adminToken) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, cacheControl: response.headers.get('cache-control'), ...(await response.json()) };
}

before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  await Promise.all([...Object.values(O), Order, EventPlan].map(model => model.init()));
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  adminToken = signToken(await User.create({ name: 'Read flow admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Customer' }));
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});

test('costing selects the latest effective price per format, including ties and historical dates', async () => {
  const supplier = await O.Supplier.create({ name: 'Price history supplier' });
  const material = await Material.create({ name: 'Price history flour', baseUom: 'g', packQuantity: 1000, packUom: 'g', purchasePrice: 50 });
  const format = await O.Format.create({ materialId: material._id, supplierId: supplier._id, minimumOrderPacks: '2' });
  await Material.updateOne({ _id: material._id }, { $set: { preferredFormatId: format._id } });
  const fields = { materialId: material._id, formatId: format._id, supplierId: supplier._id, packQuantity: '1000', packUom: 'g' };
  const history = await O.Price.create([
    { ...fields, purchasePrice: '100', effectiveAt: new Date('2026-01-01') },
    { ...fields, purchasePrice: '200', effectiveAt: new Date('2026-02-01') },
    { ...fields, purchasePrice: '250', effectiveAt: new Date('2026-02-01') },
    { ...fields, purchasePrice: '999', effectiveAt: new Date('2026-12-01') },
  ]);
  const latestTie = [...history.slice(1, 3)].sort((a, b) => String(b._id).localeCompare(String(a._id)))[0];
  for (const session of [null, await mongoose.startSession()]) {
    try {
      const verify = async () => {
        const context = await maps(session, new Date('2026-03-01'), undefined, false, false);
        assert.equal(String(context.latest.get(String(format._id))._id), String(latestTie._id));
        assert.equal(Number(context.materials.get(String(material._id)).effectiveUnitCost), Number(latestTie.purchasePrice) / 1000);
        assert.equal(context.materials.get(String(material._id)).supplierName, supplier.name);
        const historical = await maps(session, new Date('2026-01-15'), undefined, false, false);
        assert.equal(Number(historical.materials.get(String(material._id)).effectiveUnitCost), 0.1);
      };
      if (session) await session.withTransaction(verify);
      else await verify();
    } finally { if (session) await session.endSession(); }
  }
});

test('event options include unsold plans and legacy sales, preserve closed status, and stay admin-only', async () => {
  await EventPlan.create([
    { eventName: 'Open Fair', eventKey: 'open fair' },
    { eventName: 'Closed Fair', eventKey: 'closed fair', status: 'closed' },
  ]);
  const item = { product: new mongoose.Types.ObjectId(), name: 'Brownie', price: 10, quantity: 1, lineTotal: 10 };
  const fields = { items: [item], orderType: 'takeaway', pricing: { subtotal: 10, tax: 0, total: 10 } };
  await Order.create([
    { ...fields, orderNumber: 'OPTIONS-1', source: 'event', eventName: 'Legacy Fair', createdAt: new Date('2026-01-01') },
    { ...fields, orderNumber: 'OPTIONS-2', source: 'event', eventName: 'LEGACY FAIR', createdAt: new Date('2026-02-01') },
    { ...fields, orderNumber: 'OPTIONS-3', source: 'website', eventName: 'Website Order' },
  ]);
  assert.equal((await api('GET', '/admin/events/options', undefined, null)).status, 401);
  assert.equal((await api('GET', '/admin/events/options', undefined, customerToken)).status, 403);
  const result = await api('GET', '/admin/events/options');
  assert.equal(result.status, 200);
  assert.equal(result.cacheControl, 'no-store');
  assert.equal(result.events.length, 3);
  assert.equal(result.events.find(event => event.eventName === 'Closed Fair').status, 'closed');
  assert.equal(result.events.find(event => event.eventName === 'Open Fair').lastSaleAt, null);
  const legacy = result.events.find(event => event.eventName.toLowerCase() === 'legacy fair');
  assert.equal(legacy.status, 'unconfigured');
  assert.equal(legacy.lastSaleAt, '2026-02-01T00:00:00.000Z');
  for (const event of result.events) assert.deepEqual(Object.keys(event).sort(), ['eventName', 'lastSaleAt', 'status']);
});

test('a confirmed manual save returns its payment and agrees with fresh order details', async () => {
  const product = await Product.create({ name: 'Saved brownie', slug: 'saved-brownie', group: 'bakery', category: 'Brownies', price: 100 });
  const items = [{ productId: String(product._id), quantity: 1 }];
  const quote = await api('POST', '/admin/orders/quote', { items, orderType: 'takeaway' });
  assert.equal(quote.status, 200);
  const saved = await api('POST', '/admin/orders', {
    requestKey: randomUUID(), items, expectedQuote: quote, source: 'walk-in', orderType: 'takeaway',
    paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed',
  });
  assert.equal(saved.status, 201, JSON.stringify(saved));
  assert.equal(saved.payment.order, saved.order._id);
  assert.equal(saved.payment.status, 'succeeded');
  assert.equal(saved.payment.amount, saved.order.pricing.total);
  const detail = await api('GET', `/admin/orders/${saved.order._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.order.orderNumber, saved.order.orderNumber);
  assert.equal(detail.payment._id, saved.payment._id);
  assert.equal(detail.order.recipeCostSnapshot, undefined);
  assert.equal((await api('GET', `/admin/orders/${new mongoose.Types.ObjectId()}`)).status, 404);
});

test('Excel export matches list filters, ignores pagination, and requires admin access', async () => {
  const ExcelJS = require('exceljs');
  const eventName = `Export-${randomUUID()}`;
  const product = new mongoose.Types.ObjectId();
  await Order.insertMany(Array.from({ length: 31 }, (_, i) => ({
    orderNumber: `${eventName}-${i}`, source: 'event', eventName,
    items: [{ product, name: 'Export cake', price: 0, quantity: 2, lineTotal: 0 }],
    orderType: 'takeaway', pricing: { subtotal: 0, total: i === 30 ? 199 : 0, tax: 0 },
    paymentMethod: 'cash', paymentStatus: 'paid', createdAt: new Date('2026-10-10T12:00:00Z'),
  })));
  await Order.create({ orderNumber: `${eventName}-other`, source: 'event', eventName,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Other cake', price: 0, quantity: 1, lineTotal: 0 }],
    orderType: 'takeaway', pricing: { subtotal: 0, total: 0, tax: 0 }, paymentStatus: 'paid',
    createdAt: new Date('2026-10-10T12:00:00Z') });
  const filters = new URLSearchParams({ productId: String(product), source: 'event', eventName, from: '2026-10-10', to: '2026-10-10', amount: '0', payment: 'paid' });
  const listed = await api('GET', `/admin/orders?${filters}&limit=5&page=2`);
  assert.equal(listed.total, 30);
  const response = await fetch(`${base}/admin/orders/export?${filters}&limit=5&page=2`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.getWorksheet('Orders').rowCount, 31);
  for (const token of [customerToken, '']) {
    const denied = await fetch(`${base}/admin/orders/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    assert.ok([401, 403].includes(denied.status));
  }
  const invalid = await api('GET', '/admin/orders/export?amount=invalid');
  assert.equal(invalid.status, 400);
  assert.equal((await api('GET', '/admin/orders?productId=invalid')).status, 400);
  assert.equal((await api('GET', '/admin/orders/export?productId=invalid')).status, 400);
  assert.equal((await api('GET', `/admin/orders?productId=${new mongoose.Types.ObjectId()}`)).total, 0);
});
