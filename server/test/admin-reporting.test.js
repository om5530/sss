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
