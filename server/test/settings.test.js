process.env.SHOP_OPENS = '00:00';
process.env.SHOP_CLOSES = '24:00';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../src/models/Order');
const User = require('../src/models/User');
let mongod, server, base, adminToken, coffeeProduct;
const json = (method, path, body, token) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function place(payload) {
  const quote = await (await json('POST', '/cart/price', payload)).json();
  return json('POST', '/orders', { ...payload, expectedQuote: quote });
}
before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = require('../src/app').listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api';
  const admin = await User.create({ name: 'Settings admin', role: 'admin' });
  adminToken = require('../src/services/token.service').signToken(admin);
  coffeeProduct = await require('../src/models/Product').create({ name: 'Settings coffee', slug: 'settings-coffee', group: 'savoury', category: 'Coffee', price: 50 });
  assert.equal((await place({ items: [{ productId: coffeeProduct._id, quantity: 1 }], orderType: 'takeaway', paymentMethod: 'cash', takeaway: { customerName: 'Test customer', phone: '+919999000123' } })).status, 201);
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});

test('store settings are admin-managed and affect new prices immediately', async () => {
  const oldOrder = await Order.findOne().lean();
  const oldPricing = structuredClone(oldOrder.pricing);
  const initial = await (await json('GET', '/admin/settings', undefined, adminToken)).json();
  assert.equal(initial.settings.taxRate, 0.05);
  assert.equal(initial.settings.deliveryFee, 40);

  assert.equal((await json('PATCH', '/admin/settings', { currency: 'rupees' }, adminToken)).status, 400);
  assert.equal((await json('PATCH', '/admin/settings', { currency: 'usd' }, adminToken)).status, 400);
  assert.equal((await json('PATCH', '/admin/settings', { taxRate: null }, adminToken)).status, 400);
  assert.equal((await json('PATCH', '/admin/settings', { deliveryFee: 1.234 }, adminToken)).status, 400);
  assert.equal((await json('PATCH', '/admin/settings', { taxRate: 0.2 })).status, 401);
  const customer = await User.create({ name: 'Settings customer' });
  const token = require('../src/services/token.service').signToken(customer);
  assert.equal((await json('PATCH', '/admin/settings', { taxRate: 0.2 }, token)).status, 403);
  assert.equal((await json('PATCH', '/admin/settings', { opensAt: '24:30' }, adminToken)).status, 400);
  const updated = await json('PATCH', '/admin/settings', {
    taxRate: 0.12, deliveryFee: 99, currency: 'INR', opensAt: '10:00', closesAt: '23:00',
    contactAddress: '8/1307 DB Ozone, Dahisar East', contactPhone: '+919623838707', contactEmail: 'hello@bakery.test',
  }, adminToken);
  assert.equal(updated.status, 200);
  const saved = (await updated.json()).settings;
  assert.equal(saved.taxRate, 0.12);
  assert.equal(saved.currency, 'inr');

  const quote = await (await json('POST', '/cart/price', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }], orderType: 'delivery',
  })).json();
  assert.equal(quote.pricing.tax, 6);
  assert.equal(quote.pricing.deliveryFee, 99);
  assert.equal(quote.pricing.total, 155);
  const shop = await (await json('GET', '/shop')).json();
  assert.equal(shop.shop.opensAt, '10:00');
  assert.equal(shop.shop.contactAddress, '8/1307 DB Ozone, Dahisar East');
  assert.deepEqual((await Order.findById(oldOrder._id).lean()).pricing, oldPricing);
  assert.equal((await json('PATCH', '/admin/settings', { opensAt: '00:00', closesAt: '00:00' }, adminToken)).status, 200);
  const payload = { items: [{ productId: coffeeProduct._id, quantity: 1 }], orderType: 'takeaway', paymentMethod: 'cash', takeaway: { customerName: 'Hours tester', phone: '+919999000123' } };
  assert.equal((await place(payload)).status, 400);
  assert.equal((await place({ ...payload, fulfilAt: new Date(Date.now() + 3600000).toISOString() })).status, 400);

  const restored = await json('PATCH', '/admin/settings', {
    taxRate: initial.settings.taxRate, deliveryFee: initial.settings.deliveryFee,
    currency: initial.settings.currency, opensAt: initial.settings.opensAt, closesAt: initial.settings.closesAt,
    contactAddress: '', contactPhone: '', contactEmail: '',
  }, adminToken);
  assert.equal(restored.status, 200);
  assert.equal((await place(payload)).status, 201);
});
