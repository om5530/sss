// End-to-end API tests against the real Express app + an in-memory MongoDB.
// Run: npm test   (node --test; each file gets its own process)
// Pin the shop to always-open BEFORE the env module loads, so ASAP orders
// pass regardless of what IST wall-clock time CI runs at.
process.env.SHOP_OPENS = '00:00';
process.env.SHOP_CLOSES = '24:00';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let server;
let base;
let Product;
let Coupon;
let Order;
let User;
let adminToken;
let bakeProduct; // stock-tracked
let coffeeProduct; // untracked

const json = (method, path, body, token) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('bakery_test'));

  const app = require('../src/app');
  Product = require('../src/models/Product');
  Coupon = require('../src/models/Coupon');
  Order = require('../src/models/Order');
  User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;

  bakeProduct = await Product.create({
    name: 'Test Brownie', slug: 'test-brownie', group: 'bakery', category: 'Brownies',
    price: 100, available: true, stockCount: 5,
  });
  coffeeProduct = await Product.create({
    name: 'Test Coffee', slug: 'test-coffee', group: 'savoury', category: 'Coffee',
    price: 50, available: true, // untracked stock
  });

  const admin = await User.create({ phone: '+911111111111', name: 'Test Admin', role: 'admin' });
  adminToken = signToken(admin);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});

/* ---------------- Pricing & coupons ---------------- */

test('prices a cart with 5% tax and delivery fee only for delivery', async () => {
  const res = await json('POST', '/cart/price', {
    items: [{ productId: bakeProduct._id, quantity: 2 }],
    orderType: 'takeaway',
  });
  const bodyT = await res.json();
  assert.equal(res.status, 200);
  assert.equal(bodyT.pricing.subtotal, 200);
  assert.equal(bodyT.pricing.tax, 10);
  assert.equal(bodyT.pricing.deliveryFee, 0);
  assert.equal(bodyT.pricing.total, 210);

  const resD = await json('POST', '/cart/price', {
    items: [{ productId: bakeProduct._id, quantity: 2 }],
    orderType: 'delivery',
  });
  const bodyD = await resD.json();
  assert.equal(bodyD.pricing.deliveryFee, 40);
  assert.equal(bodyD.pricing.total, 250);
});

test('applies a percent coupon: discount before tax, capped by maxDiscount', async () => {
  await Coupon.create({ code: 'TEN', type: 'percent', value: 10, maxDiscount: 15 });
  const res = await json('POST', '/cart/price', {
    items: [{ productId: bakeProduct._id, quantity: 2 }], // subtotal 200
    orderType: 'takeaway',
    couponCode: 'ten', // case-insensitive
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.pricing.discount, 15); // 10% of 200 = 20 → capped at 15
  assert.equal(body.pricing.tax, 9.25); // 5% of 185
  assert.equal(body.pricing.total, 194.25);
  assert.equal(body.pricing.couponCode, 'TEN');
});

test('rejects invalid, expired and below-minimum coupons with clear messages', async () => {
  await Coupon.create({ code: 'GONE', type: 'flat', value: 20, expiresAt: new Date(Date.now() - 1000) });
  await Coupon.create({ code: 'BIGCART', type: 'flat', value: 20, minSubtotal: 1000 });

  for (const [code, fragment] of [
    ['NOPE', 'isn’t valid'],
    ['GONE', 'expired'],
    ['BIGCART', 'more to use'],
  ]) {
    const res = await json('POST', '/cart/price', {
      items: [{ productId: bakeProduct._id, quantity: 1 }],
      orderType: 'takeaway',
      couponCode: code,
    });
    const body = await res.json();
    assert.equal(res.status, 400, code);
    assert.match(body.message, new RegExp(fragment.replace(/[’]/g, '.')), code);
  }
});

/* ---------------- Stock tracking ---------------- */

test('orders decrement tracked stock, oversell is rejected, cancel restocks', async () => {
  // Claim 2 of 5.
  const res1 = await json('POST', '/orders', {
    items: [{ productId: bakeProduct._id, quantity: 2 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Stock Tester', phone: '+919999000001' },
  });
  assert.equal(res1.status, 201);
  const order1 = (await res1.json()).order;
  assert.equal((await Product.findById(bakeProduct._id)).stockCount, 3);

  // Try to claim 4 with 3 left → 409, stock untouched.
  const res2 = await json('POST', '/orders', {
    items: [{ productId: bakeProduct._id, quantity: 4 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Greedy', phone: '+919999000002' },
  });
  assert.equal(res2.status, 409);
  assert.equal((await Product.findById(bakeProduct._id)).stockCount, 3);

  // Claim the remaining 3 → sold out + auto-hidden.
  const res3 = await json('POST', '/orders', {
    items: [{ productId: bakeProduct._id, quantity: 3 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Last Crumb', phone: '+919999000003' },
  });
  assert.equal(res3.status, 201);
  const soldOut = await Product.findById(bakeProduct._id);
  assert.equal(soldOut.stockCount, 0);
  assert.equal(soldOut.available, false);

  // Cancelling order1 restocks 2 and re-enables the product.
  const cancel = await json('PATCH', `/admin/orders/${order1._id}/status`, { status: 'cancelled', note: 'test' }, adminToken);
  assert.equal(cancel.status, 200);
  const restocked = await Product.findById(bakeProduct._id);
  assert.equal(restocked.stockCount, 2);
  assert.equal(restocked.available, true);

  // Untracked products never 409 on stock.
  const res4 = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 99 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Thirsty', phone: '+919999000004' },
  });
  assert.equal(res4.status, 201);
  assert.equal((await Product.findById(coffeeProduct._id)).stockCount, null);
});

test('coupon slots: reserved atomically at order time, released on cancellation', async () => {
  await Coupon.create({ code: 'LIMIT1', type: 'flat', value: 10, usageLimit: 1 });

  // First order consumes the only slot.
  const res1 = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash', couponCode: 'LIMIT1',
    takeaway: { customerName: 'Coupon One', phone: '+919999000010' },
  });
  assert.equal(res1.status, 201);
  const order1 = (await res1.json()).order;
  assert.equal(order1.pricing.discount, 10);
  assert.equal((await Coupon.findOne({ code: 'LIMIT1' })).usedCount, 1);

  // Second use is rejected — the limit is enforced at reservation time.
  const res2 = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash', couponCode: 'LIMIT1',
    takeaway: { customerName: 'Coupon Two', phone: '+919999000011' },
  });
  assert.equal(res2.status, 400);

  // Cancelling the first order hands the slot back.
  const cancel = await json('PATCH', `/admin/orders/${order1._id}/status`, { status: 'cancelled', note: 'test' }, adminToken);
  assert.equal(cancel.status, 200);
  assert.equal((await Coupon.findOne({ code: 'LIMIT1' })).usedCount, 0);

  const res3 = await json('POST', '/cart/price', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', couponCode: 'LIMIT1',
  });
  assert.equal(res3.status, 200);
});

test('cancel never restocks lines that did not claim stock (tracking enabled later)', async () => {
  // Ordered while untracked…
  const res = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 2 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Phantom', phone: '+919999000012' },
  });
  assert.equal(res.status, 201);
  const order = (await res.json()).order;
  assert.equal(order.items[0].stockClaimed, false);

  // …then the admin starts tracking with a real count…
  await Product.updateOne({ _id: coffeeProduct._id }, { stockCount: 10 });

  // …and a cancellation must NOT invent 2 phantom units.
  const cancel = await json('PATCH', `/admin/orders/${order._id}/status`, { status: 'cancelled', note: 'test' }, adminToken);
  assert.equal(cancel.status, 200);
  assert.equal((await Product.findById(coffeeProduct._id)).stockCount, 10);

  // Reset for later tests.
  await Product.updateOne({ _id: coffeeProduct._id }, { stockCount: null });
});

test('cancel does not resurrect a product the admin hid while stock remained', async () => {
  const hidden = await Product.create({
    name: 'Hidden Tart', slug: 'hidden-tart', group: 'bakery', category: 'Tarts',
    price: 80, available: true, stockCount: 10,
  });
  const res = await json('POST', '/orders', {
    items: [{ productId: hidden._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Hider', phone: '+919999000013' },
  });
  const order = (await res.json()).order;

  // Admin hides it manually with stock still on hand.
  await Product.updateOne({ _id: hidden._id }, { available: false });

  await json('PATCH', `/admin/orders/${order._id}/status`, { status: 'cancelled', note: 'test' }, adminToken);
  const after = await Product.findById(hidden._id);
  assert.equal(after.stockCount, 10); // restocked
  assert.equal(after.available, false); // but stays hidden — the admin said so
});

test('scheduling: lead-time and horizon are enforced; valid pre-orders persist fulfilAt', async () => {
  const payload = (fulfilAt) => ({
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash', fulfilAt,
    takeaway: { customerName: 'Scheduler', phone: '+919999000020' },
  });

  // Less than 30 minutes of notice → rejected.
  const tooSoon = await json('POST', '/orders', payload(new Date(Date.now() + 10 * 60 * 1000).toISOString()));
  assert.equal(tooSoon.status, 400);

  // More than 2 days ahead → rejected.
  const tooFar = await json('POST', '/orders', payload(new Date(Date.now() + 3 * 86400000).toISOString()));
  assert.equal(tooFar.status, 400);

  // Tomorrow (always-open window in this test process) → accepted + stored.
  const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const ok = await json('POST', '/orders', payload(when));
  assert.equal(ok.status, 201);
  const order = (await ok.json()).order;
  assert.equal(new Date(order.fulfilAt).toISOString(), when);
});

/* ---------------- Order lifecycle ---------------- */

test('lifecycle: only legal forward moves; cancellation needs a reason', async () => {
  const res = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Flow', phone: '+919999000005' },
  });
  const order = (await res.json()).order;

  // placed → ready is illegal.
  const skip = await json('PATCH', `/admin/orders/${order._id}/status`, { status: 'ready' }, adminToken);
  assert.equal(skip.status, 400);

  // cancelled without a reason is rejected.
  const noReason = await json('PATCH', `/admin/orders/${order._id}/status`, { status: 'cancelled' }, adminToken);
  assert.equal(noReason.status, 400);

  // placed → confirmed is legal.
  const ok = await json('PATCH', `/admin/orders/${order._id}/status`, { status: 'confirmed' }, adminToken);
  assert.equal(ok.status, 200);
});

/* ---------------- Cash settlement guards ---------------- */

test('settle-cash: pays once, never twice, never after refund, never for online orders', async () => {
  const res = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Cash Guard', phone: '+919999000006' },
  });
  const order = (await res.json()).order;

  const settle = await json('POST', `/admin/orders/${order._id}/settle-cash`, {}, adminToken);
  assert.equal(settle.status, 200);
  const settled = (await settle.json()).order;
  assert.equal(settled.paymentStatus, 'paid');
  assert.equal(settled.orderStatus, 'confirmed');

  const again = await json('POST', `/admin/orders/${order._id}/settle-cash`, {}, adminToken);
  assert.equal(again.status, 409);

  await Order.updateOne({ _id: order._id }, { paymentStatus: 'refunded' });
  const afterRefund = await json('POST', `/admin/orders/${order._id}/settle-cash`, {}, adminToken);
  assert.equal(afterRefund.status, 409);

  const online = await json('POST', '/orders', {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'online',
    takeaway: { customerName: 'Online Guard', phone: '+919999000007' },
  });
  const onlineOrder = (await online.json()).order;
  const wrong = await json('POST', `/admin/orders/${onlineOrder._id}/settle-cash`, {}, adminToken);
  assert.equal(wrong.status, 400);
});

/* ---------------- Reviews ---------------- */

test('reviews are verified-purchase only and update the product stats', async () => {
  const { signToken } = require('../src/services/token.service');
  const customer = await User.create({ phone: '+912222222222', name: 'Reviewer', role: 'customer' });
  const token = signToken(customer);

  // No completed order yet → 403.
  const early = await json('POST', `/products/${coffeeProduct.slug}/reviews`, { rating: 5, text: 'great' }, token);
  assert.equal(early.status, 403);

  // Give them a completed order containing the product.
  await Order.create({
    orderNumber: 'BC-TEST-REVIEW', user: customer._id,
    items: [{ product: coffeeProduct._id, name: coffeeProduct.name, price: 50, quantity: 1, lineTotal: 50 }],
    orderType: 'takeaway', takeaway: { customerName: 'Reviewer', phone: '+912222222222' },
    pricing: { subtotal: 50, tax: 2.5, deliveryFee: 0, total: 52.5 },
    paymentMethod: 'cash', paymentStatus: 'paid', orderStatus: 'completed',
  });

  const ok = await json('POST', `/products/${coffeeProduct.slug}/reviews`, { rating: 4, text: 'Solid brew' }, token);
  assert.equal(ok.status, 201);

  const updated = await Product.findById(coffeeProduct._id);
  assert.equal(updated.ratingCount, 1);
  assert.equal(updated.ratingAvg, 4);

  // Upsert, not duplicate.
  const edit = await json('POST', `/products/${coffeeProduct.slug}/reviews`, { rating: 2, text: 'changed my mind' }, token);
  assert.equal(edit.status, 201);
  const after = await Product.findById(coffeeProduct._id);
  assert.equal(after.ratingCount, 1);
  assert.equal(after.ratingAvg, 2);

  const list = await json('GET', `/products/${coffeeProduct.slug}/reviews`);
  const listBody = await list.json();
  assert.equal(listBody.reviews.length, 1);
});

/* ---------------- Contact + cake validation ---------------- */

test('contact and cake submissions validate their input', async () => {
  const badEmail = await json('POST', '/contact', { name: 'X', email: 'nope', message: 'hi' });
  assert.equal(badEmail.status, 400);

  const okContact = await json('POST', '/contact', { name: 'X', email: 'x@y.com', message: 'hello there' });
  assert.equal(okContact.status, 201);

  const pastCake = await json('POST', '/cake-requests', {
    name: 'C', phone: '+911', occasion: 'Birthday', servings: 10, flavour: 'Chocolate truffle',
    dateNeeded: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(pastCake.status, 400);

  const okCake = await json('POST', '/cake-requests', {
    name: 'C', phone: '+911234567890', occasion: 'Birthday', servings: 10, flavour: 'Chocolate truffle',
    dateNeeded: new Date(Date.now() + 3 * 86400000).toISOString(),
  });
  assert.equal(okCake.status, 201);

  // The form's own minimum — the date-only string for tomorrow (UTC) — must be
  // accepted: date-only parses as UTC midnight and used to lose to the +24h instant.
  const minCake = await json('POST', '/cake-requests', {
    name: 'C', phone: '+911234567890', occasion: 'Birthday', servings: 10, flavour: 'Chocolate truffle',
    dateNeeded: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  });
  assert.equal(minCake.status, 201);
});
