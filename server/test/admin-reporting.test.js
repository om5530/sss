const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
let mongod, server, base, adminToken, customerToken;
const json = (method, path, body, token = adminToken) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = require('../src/app').listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api';
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  adminToken = signToken(await User.create({ name: 'Report admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Report customer' }));
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});
test('reports rank the full catalogue and resolve renamed categories without changing revenue', async () => {
  const Product = require('../src/models/Product');
  const Order = require('../src/models/Order');
  const Category = require('../src/models/Category');
  const category = await Category.create({ name: 'Old label', nameKey: 'old label', group: 'bakery' });
  for (let i = 0; i < 12; i++) {
    const product = await Product.create({ name: 'Bake ' + i, slug: 'bake-' + i, group: 'bakery', category: 'Old label', categoryId: category._id, price: i === 11 ? 1 : 100, archived: i === 11 });
    const quantity = i === 11 ? 20 : 1;
    const total = product.price * quantity;
    await Order.create({ orderNumber: 'REPORT-' + i, orderType: 'takeaway', paymentStatus: 'paid', orderStatus: 'completed',
      items: [{ product: product._id, name: product.name, price: product.price, quantity, lineTotal: total }], pricing: { subtotal: total, tax: 0, total } });
  }
  assert.equal((await json('PATCH', '/admin/categories/' + category._id, { name: 'Fresh bakes' })).status, 200);
  const revenue = await (await json('GET', '/admin/reports/products')).json();
  assert.equal(revenue.topProducts.length, 10);
  assert.equal(revenue.topProducts[0].revenue, 100);
  assert.equal(revenue.topProducts[0].category, 'Fresh bakes');
  assert.deepEqual(revenue.byCategory, [{ quantity: 31, revenue: 1120, category: 'Fresh bakes' }]);
  const quantity = await (await json('GET', '/admin/reports/products?rankBy=quantity')).json();
  assert.equal(quantity.topProducts[0].name, 'Bake 11');
  assert.equal(quantity.topProducts[0].quantity, 20);
  assert.equal(quantity.topProducts[0].archived, true);
  assert.deepEqual(quantity.byCategory, revenue.byCategory);
  assert.equal((await json('GET', '/admin/reports/products', undefined, customerToken)).status, 403);
});
test('customer search uses a private body, preserves pagination and requires admin access', async () => {
  const User = require('../src/models/User');
  const customer = await User.create({ name: 'Private Search Alpha', email: 'private-search@example.test', phone: '+919876543210' });
  await User.create({ name: 'Private Search Beta' });
  for (const q of ['Search Alpha', 'private-search@example.test', '+919876543210']) {
    const response = await json('POST', '/admin/customers/search', { q });
    assert.equal(response.status, 200);
    assert.equal(new URL(response.url).search, '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.total, 1);
    assert.equal(result.customers[0]._id, String(customer._id));
    assert.equal(result.customers[0].orderCount, 0);
  }
  const first = await (await json('POST', '/admin/customers/search', { q: 'Private Search', page: 1, limit: 1 })).json();
  const second = await (await json('POST', '/admin/customers/search', { q: 'Private Search', page: 2, limit: 1 })).json();
  assert.equal(first.total, 2);
  assert.equal(first.pages, 2);
  assert.notEqual(first.customers[0]._id, second.customers[0]._id);
  assert.equal((await json('GET', '/admin/customers?page=1')).status, 200);
  assert.equal((await json('POST', '/admin/customers/search', { q: 'Private Search' }, customerToken)).status, 403);
  assert.equal((await json('POST', '/admin/customers/search', {}, null)).status, 401);
  for (const filters of [{ q: { $ne: null } }, { q: 'x'.repeat(201) }, { page: -1 }, { limit: 'invalid' }]) {
    assert.equal((await json('POST', '/admin/customers/search', filters)).status, 400);
  }
});

test('customer searches do not leak through access logs or failure diagnostics', async (t) => {
  const marker = 'sensitive-search@example.test';
  const output = [];
  const write = process.stdout.write.bind(process.stdout);
  t.mock.method(process.stdout, 'write', (...args) => {
    output.push(String(args[0]));
    return write(...args);
  });
  t.mock.method(console, 'error', (...args) => output.push(JSON.stringify(args)));
  const legacy = await json('GET', '/admin/customers?q=' + encodeURIComponent(marker));
  assert.equal(legacy.status, 400);
  assert.ok(!(await legacy.text()).includes(marker));
  assert.equal((await json('POST', '/admin/customers/search', { q: marker })).status, 200);
  const User = require('../src/models/User');
  t.mock.method(User, 'aggregate', () => { throw new Error('Query failed: ' + marker); });
  const failure = await json('POST', '/admin/customers/search', { q: marker });
  assert.equal(failure.status, 500);
  const body = await failure.json();
  assert.ok(body.requestId);
  assert.equal(body.stack, undefined);
  assert.ok(!JSON.stringify(body).includes(marker));
  assert.ok(output.some((line) => line.includes(body.requestId)));
  assert.ok(!output.join('\n').includes(marker));
  assert.ok(!output.join('\n').includes(encodeURIComponent(marker)));
});

test('unread enquiry counts include only new messages and are admin-only', async () => {
  const ContactMessage = require('../src/models/ContactMessage');
  const message = await ContactMessage.create({ name: 'Sender', email: 'sender@example.test', message: 'Question' });
  await ContactMessage.create({ name: 'Read sender', email: 'read@example.test', message: 'Read question', status: 'read' });
  const response = await json('GET', '/admin/messages/unread-count');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).newCount, 1);
  assert.equal((await json('PATCH', '/admin/messages/' + message._id + '/status', { status: 'read' })).status, 200);
  assert.equal((await (await json('GET', '/admin/messages/unread-count')).json()).newCount, 0);
  assert.equal((await json('GET', '/admin/messages/unread-count', undefined, customerToken)).status, 403);
  assert.equal((await json('GET', '/admin/messages/unread-count', undefined, null)).status, 401);
});
