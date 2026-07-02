// Opening-hours + scheduling rules. opens === closes ⇒ the shop is NEVER open
// (deterministic regardless of when the test runs); scheduling limits are
// tested in the always-open integration file's process instead.
process.env.SHOP_OPENS = '00:00';
process.env.SHOP_CLOSES = '00:00';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let server;
let base;
let product;

const json = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('bakery_hours_test'));
  const app = require('../src/app');
  const Product = require('../src/models/Product');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
  product = await Product.create({
    name: 'Night Bun', slug: 'night-bun', group: 'bakery', category: 'Buns', price: 40, available: true,
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});

test('/api/shop reports the configured window and closed state', async () => {
  const res = await json('GET', '/shop');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.shop.opensAt, '00:00');
  assert.equal(body.shop.closesAt, '00:00');
  assert.equal(body.shop.openNow, false);
});

test('ASAP orders are rejected while the shop is closed', async () => {
  const res = await json('POST', '/orders', {
    items: [{ productId: product._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Night Owl', phone: '+919999000021' },
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.message, /ovens are off/i);
});

test('scheduled orders must land inside opening hours', async () => {
  const res = await json('POST', '/orders', {
    items: [{ productId: product._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    fulfilAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), // 5h out — but never open
    takeaway: { customerName: 'Planner', phone: '+919999000022' },
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.message, /outside our opening hours/i);
});
