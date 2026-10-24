process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../src/models/Product');
const Recipe = require('../src/models/BakeryRecipe');
const Order = require('../src/models/Order');
let database, server, base, adminToken, customerToken;
async function api(method, path, body, token = adminToken) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ['--nounixsocket'] }] });
  await mongoose.connect(database.getUri());
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  adminToken = signToken(await User.create({ name: 'Delete admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Customer' }));
  await Promise.all([Product.init(), Recipe.init(), Order.init()]);
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});
async function product(archived = true) {
  return Product.create({ name: 'Delete brownie', slug: `delete-${new mongoose.Types.ObjectId()}`, group: 'bakery', category: 'Brownies', price: 100, archived, available: !archived });
}
test('deletion requires an admin, explicit confirmation and an archived product', async () => {
  const p = await product(false), path = `/admin/products/${p._id}`;
  assert.equal((await api('DELETE', path, { confirmed: true }, null)).status, 401);
  assert.equal((await api('DELETE', path, { confirmed: true }, customerToken)).status, 403);
  assert.equal((await api('DELETE', path, {})).status, 400);
  assert.equal((await api('DELETE', path, { confirmed: true })).status, 409);
  assert.equal((await Product.findById(p._id)).deletedAt, null);
});
test('deletion hides the catalogue entry, unlinks recipes, and preserves history', async () => {
  const p = await product(), path = `/admin/products/${p._id}`;
  const recipe = await Recipe.create({ name: 'Linked brownie', productId: p._id, components: [] });
  const order = await Order.create({ orderNumber: `DELETE-${p._id}`, orderType: 'takeaway', orderStatus: 'completed', paymentStatus: 'paid',
    source: 'event', eventName: 'Delete test stall', items: [{ product: p._id, name: p.name, price: 100, quantity: 2, lineTotal: 200 }],
    pricing: { subtotal: 200, tax: 0, total: 200 } });
  assert.equal((await api('DELETE', path, { confirmed: true })).status, 200);
  for (const query of ['', '?archived=true', '?archived=all']) {
    const list = await api('GET', '/admin/products' + query);
    assert.equal(list.status, 200);
    assert.ok(!list.products.some(item => item._id === String(p._id)));
  }
  assert.equal((await api('GET', path)).status, 404);
  assert.equal((await api('PATCH', path + '/archive', { archived: false })).status, 404);
  assert.equal((await api('DELETE', path, { confirmed: true })).status, 404);
  assert.equal((await Recipe.findById(recipe._id)).productId, null);
  const historical = await Order.findById(order._id).populate('items.product');
  assert.equal(historical.items[0].name, p.name);
  assert.equal(historical.pricing.total, 200);
  assert.equal(historical.items[0].product.name, p.name);
  assert.ok(historical.items[0].product.deletedAt);
  assert.equal(await Product.exists({ slug: p.slug }), null);
  const report = await api('GET', '/admin/reports/events?eventName=Delete%20test%20stall');
  assert.equal(report.status, 200);
  assert.equal(report.stock.find(row => row.productId === String(p._id)).sold, 2);
});
