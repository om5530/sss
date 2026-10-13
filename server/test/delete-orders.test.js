process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const Product = require('../src/models/Product');

let database, server, base, adminToken, customerToken, product;
const request = (method, path, token = adminToken) => fetch(base + path, {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {},
});

before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  adminToken = signToken(await User.create({ name: 'Delete admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Customer' }));
  product = await Product.create({ name: 'Brownie', slug: 'delete-test-brownie', group: 'bakery', category: 'Brownies', price: 100, stockCount: 8 });
  await Promise.all([Order.init(), Payment.init()]);
  server = require('../src/app').listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});

async function createOrder(status = 'completed') {
  const order = await Order.create({
    orderNumber: `DELETE-${new mongoose.Types.ObjectId()}`,
    orderType: 'takeaway', orderStatus: status, paymentStatus: 'paid',
    items: [{ product: product._id, name: 'Brownie', price: 100, quantity: 2, lineTotal: 200, stockClaimed: true }],
    pricing: { subtotal: 200, tax: 0, total: 200 },
  });
  await Payment.create({ order: order._id, amount: 200, status: 'succeeded', provider: 'cash' });
  return order;
}

test('only admins can permanently delete orders', async () => {
  const order = await createOrder();
  assert.equal((await request('DELETE', `/admin/orders/${order._id}`, null)).status, 401);
  assert.equal((await request('DELETE', `/admin/orders/${order._id}`, customerToken)).status, 403);
  assert.ok(await Order.findById(order._id));
  assert.equal(await Payment.countDocuments({ order: order._id }), 1);
});

test('permanent deletion removes orders and payments from lists without restocking', async () => {
  for (const status of ['completed', 'placed', 'cancelled']) {
    const order = await createOrder(status);
    const response = await request('DELETE', `/admin/orders/${order._id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(await Order.findById(order._id), null);
    assert.equal(await Payment.countDocuments({ order: order._id }), 0);
    assert.equal((await request('GET', `/admin/orders/${order._id}`)).status, 404);
    const list = await (await request('GET', `/admin/orders?q=${order.orderNumber}`)).json();
    assert.equal(list.total, 0);
    assert.equal((await request('DELETE', `/admin/orders/${order._id}`)).status, 404);
  }
  assert.equal((await Product.findById(product._id)).stockCount, 8);
});

test('invalid and missing order IDs return not found', async () => {
  for (const id of ['invalid', new mongoose.Types.ObjectId()]) {
    assert.equal((await request('DELETE', `/admin/orders/${id}`)).status, 404);
  }
});

test('payment deletion failure rolls back order deletion', async (t) => {
  const order = await createOrder();
  const stub = t.mock.method(Payment, 'deleteMany', async () => { throw new Error('Payment deletion failed'); });
  try {
    assert.equal((await request('DELETE', `/admin/orders/${order._id}`)).status, 500);
    assert.ok(await Order.findById(order._id));
    assert.equal(await Payment.countDocuments({ order: order._id }), 1);
  } finally {
    stub.mock.restore();
  }
});
