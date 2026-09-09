// End-to-end API tests against the real Express app + an in-memory MongoDB.
// Run: npm test   (node --test; each file gets its own process)
// Pin the shop to always-open BEFORE the env module loads, so ASAP orders
// pass regardless of what IST wall-clock time CI runs at.
process.env.SHOP_OPENS = '00:00';
process.env.SHOP_CLOSES = '24:00';
// Exercise local mock login independently of developer Firebase credentials.
process.env.NODE_ENV = 'test';
process.env.OTP_PROVIDER = 'mock';
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';

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

// Existing order scenarios now follow the same review-then-submit contract as checkout.
async function place(payload, token) {
  const response = await json('POST', '/cart/price', payload);
  const quote = await response.json();
  return json('POST', '/orders', {
    ...payload,
    expectedQuote: quote.items ? { items: quote.items, pricing: quote.pricing } : {
      items: payload.items.map((i) => ({ product: i.productId, quantity: i.quantity, price: 0 })), pricing: {},
    },
  }, token);
}

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
  const res1 = await place( {
    items: [{ productId: bakeProduct._id, quantity: 2 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Stock Tester', phone: '+919999000001' },
  });
  assert.equal(res1.status, 201);
  const order1 = (await res1.json()).order;
  assert.equal((await Product.findById(bakeProduct._id)).stockCount, 3);

  // Try to claim 4 with 3 left → 409, stock untouched.
  const res2 = await place( {
    items: [{ productId: bakeProduct._id, quantity: 4 }],
    orderType: 'takeaway', paymentMethod: 'cash',
    takeaway: { customerName: 'Greedy', phone: '+919999000002' },
  });
  assert.equal(res2.status, 409);
  assert.equal((await Product.findById(bakeProduct._id)).stockCount, 3);

  // Claim the remaining 3 → sold out + auto-hidden.
  const res3 = await place( {
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
  const res4 = await place( {
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
  const res1 = await place( {
    items: [{ productId: coffeeProduct._id, quantity: 1 }],
    orderType: 'takeaway', paymentMethod: 'cash', couponCode: 'LIMIT1',
    takeaway: { customerName: 'Coupon One', phone: '+919999000010' },
  });
  assert.equal(res1.status, 201);
  const order1 = (await res1.json()).order;
  assert.equal(order1.pricing.discount, 10);
  assert.equal((await Coupon.findOne({ code: 'LIMIT1' })).usedCount, 1);

  // Second use is rejected — the limit is enforced at reservation time.
  const res2 = await place( {
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
  const res = await place( {
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
  const res = await place( {
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
  const tooSoon = await place( payload(new Date(Date.now() + 10 * 60 * 1000).toISOString()));
  assert.equal(tooSoon.status, 400);

  // More than 2 days ahead → rejected.
  const tooFar = await place( payload(new Date(Date.now() + 3 * 86400000).toISOString()));
  assert.equal(tooFar.status, 400);

  // Tomorrow (always-open window in this test process) → accepted + stored.
  const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const ok = await place( payload(when));
  assert.equal(ok.status, 201);
  const order = (await ok.json()).order;
  assert.equal(new Date(order.fulfilAt).toISOString(), when);
});

/* ---------------- Order lifecycle ---------------- */

test('lifecycle: only legal forward moves; cancellation needs a reason', async () => {
  const res = await place( {
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
  const res = await place( {
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

  const online = await place( {
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

test('managed categories migrate, rename, filter and reorder without changing product references', async () => {
  const updatedAt = (await Product.findById(bakeProduct._id)).updatedAt;
  const categoryRes = await json('GET', '/admin/categories', undefined, adminToken);
  assert.equal(categoryRes.status, 200);
  const categories = (await categoryRes.json()).categories;
  const brownie = categories.find((c) => c.name === 'Brownies');
  assert.ok(brownie);
  const migrated = await Product.findById(bakeProduct._id);
  assert.equal(migrated.updatedAt.getTime(), updatedAt.getTime());
  assert.equal(String(migrated.categoryId), brownie._id);
  const rename = await json('PATCH', `/admin/categories/${brownie._id}`, { name: 'Fresh Brownies', group: 'bakery' }, adminToken);
  assert.equal(rename.status, 200);
  assert.equal(String((await Product.findById(bakeProduct._id)).categoryId), brownie._id);
  const publicProduct = await (await json('GET', `/products/${bakeProduct.slug}`)).json();
  assert.equal(publicProduct.product.category, 'Fresh Brownies');
  const filtered = await (await json('GET', '/admin/products?category=Fresh%20Brownies', undefined, adminToken)).json();
  assert.ok(filtered.products.some((p) => p._id === String(bakeProduct._id)));
  assert.equal((await json('DELETE', `/admin/categories/${brownie._id}`, undefined, adminToken)).status, 409);
  assert.equal((await json('POST', '/admin/categories', { name: 'fresh brownies', group: 'bakery' }, adminToken)).status, 409);
  const created = await json('POST', '/admin/categories', { name: 'New Bakes', group: 'bakery' }, adminToken);
  assert.equal(created.status, 201);
  const newCategory = (await created.json()).category;
  const productData = { name: 'Managed Cake', group: 'bakery', category: 'New Bakes', price: 50, dietary: 'veg', available: true };
  const added = await json('POST', '/admin/products', productData, adminToken);
  assert.equal(added.status, 201);
  const product = (await added.json()).product;
  const all = (await (await json('GET', '/admin/categories', undefined, adminToken)).json()).categories.filter((c) => c.group === 'bakery');
  const ids = [newCategory._id, ...all.filter((c) => c._id !== newCategory._id).map((c) => c._id)];
  assert.equal((await json('PATCH', '/admin/categories/order', { group: 'bakery', ids }, adminToken)).status, 200);
  const menu = await (await json('GET', '/products/menu')).json();
  assert.equal(Object.keys(menu.menu.bakery)[0], 'New Bakes');
  const reassign = await json('PATCH', `/admin/products/${product._id}`, { category: 'Fresh Brownies' }, adminToken);
  assert.equal(reassign.status, 200);
  assert.equal((await json('DELETE', `/admin/categories/${newCategory._id}`, undefined, adminToken)).status, 200);
  assert.equal((await json('POST', '/admin/products', { ...productData, name: 'Unknown category product' }, adminToken)).status, 400);
  const user = await User.create({ name: 'Not admin' });
  const token = require('../src/services/token.service').signToken(user);
  assert.equal((await json('POST', '/admin/categories', { name: 'Forbidden', group: 'bakery' }, token)).status, 403);
});

test('customer deactivation rejects existing credentials, requires a reason and preserves orders', async () => {
  const { signToken } = require('../src/services/token.service');
  const user = await User.create({ name: 'Status customer', phone: '+919876540123' });
  const token = signToken(user);
  const admin = await User.findOne({ role: 'admin', phone: '+911111111111' });
  assert.equal((await json('PATCH', `/admin/customers/${admin._id}/status`, { active: false, reason: 'test' }, adminToken)).status, 409);
  assert.equal((await json('PATCH', `/admin/customers/${user._id}/status`, { active: false }, adminToken)).status, 400);
  const beforeCount = await Order.countDocuments();
  assert.equal((await json('PATCH', `/admin/customers/${user._id}/status`, { active: false, reason: 'Abuse report' }, adminToken)).status, 200);
  assert.equal((await json('GET', '/auth/me', undefined, token)).status, 403);
  await require('../src/models/Otp').create({ phone: user.phone, codeHash: require('crypto').createHash('sha256').update('123456').digest('hex'), expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await json('POST', '/auth/otp/verify', { phone: user.phone, code: '123456' })).status, 403);
  assert.equal((await json('GET', `/products/${coffeeProduct.slug}/reviews`, undefined, token)).status, 403);
  assert.equal(await Order.countDocuments(), beforeCount);
  assert.equal((await json('PATCH', `/admin/customers/${user._id}/status`, { active: true }, adminToken)).status, 200);
  assert.equal((await json('GET', '/auth/me', undefined, token)).status, 401);
  assert.equal((await json('GET', '/auth/me', undefined, signToken(await User.findById(user._id)))).status, 200);
});

test('admin idle expiry is server-enforced and polling never renews it', async () => {
  const { signToken } = require('../src/services/token.service');
  const AdminSession = require('../src/models/AdminSession');
  const user = await User.create({ name: 'Idle admin', role: 'admin' });
  const token = signToken(user);
  assert.equal((await json('GET', '/auth/me', undefined, token)).status, 200);
  const session = await AdminSession.findOne({ user: user._id });
  const before = session.lastActiveAt.getTime();
  assert.equal((await json('GET', '/admin/orders', undefined, token)).status, 200);
  assert.equal((await AdminSession.findById(session._id)).lastActiveAt.getTime(), before);
  assert.equal((await json('POST', '/auth/activity', {}, token)).status, 200);
  assert.ok((await AdminSession.findById(session._id)).lastActiveAt.getTime() >= before);
  await AdminSession.updateOne({ _id: session._id }, { lastActiveAt: new Date(Date.now() - 31 * 60_000) });
  assert.equal((await json('GET', '/admin/orders', undefined, token)).status, 401);
  assert.equal((await json('POST', '/auth/activity', {}, token)).status, 401);
  // A fresh sign-in has its own session even when issued in the same second.
  const fresh = signToken(user);
  assert.notEqual(fresh, token);
  assert.equal((await json('GET', '/admin/orders', undefined, fresh)).status, 200);
  const customer = await User.create({ name: 'Regular customer' });
  assert.equal((await json('POST', '/auth/activity', {}, signToken(customer))).status, 403);
});

test('errors carry a server-generated correlation id', async () => {
  const response = await json('POST', '/auth/addresses', {});
  const result = await response.json();
  assert.equal(response.status, 401);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), result.requestId);
});

test('logout revokes bearer/cookie sessions, optional-auth identity and admin access', async () => {
  const { signToken } = require('../src/services/token.service');
  for (const role of ['customer', 'admin']) {
    const user = await User.create({ name: 'Session tester', role });
    const token = signToken(user);
    const order = await Order.create({
      orderNumber: `BC-SESSION-${role}`, user: user._id,
      items: [{ product: coffeeProduct._id, name: 'Coffee', price: 50, quantity: 1, lineTotal: 50 }],
      orderType: 'takeaway', pricing: { subtotal: 50, tax: 2.5, deliveryFee: 0, total: 52.5 },
    });
    assert.equal((await json('GET', '/auth/me', undefined, token)).status, 200);
    assert.equal((await json('POST', '/auth/logout', {}, token)).status, 200);
    assert.equal((await json('GET', '/auth/me', undefined, token)).status, 401);
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: `token=${token}` } })).status, 401);
    assert.equal((await json('GET', `/orders/${order._id}`, undefined, token)).status, 403);
    assert.equal((await json('GET', '/admin/orders', undefined, token)).status, 401);
    const fresh = signToken(await User.findById(user._id));
    assert.equal((await json('GET', '/auth/me', undefined, fresh)).status, 200);
  }
});

test('changed or missing reviewed prices never create an order or reserve stock/coupons', async () => {
  const product = await Product.create({ name: 'Quote Tart', slug: 'quote-tart', group: 'bakery', category: 'Tarts', price: 100, stockCount: 5 });
  const coupon = await Coupon.create({ code: 'QUOTE', type: 'flat', value: 10, usageLimit: 5 });
  const payload = { items: [{ productId: String(product._id), quantity: 1 }], orderType: 'takeaway', paymentMethod: 'cash', couponCode: coupon.code,
    takeaway: { customerName: 'Quote tester', phone: '+919999111222' } };
  const reviewed = await (await json('POST', '/cart/price', payload)).json();
  const count = await Order.countDocuments();
  assert.equal((await json('POST', '/orders', payload)).status, 400);
  await Product.updateOne({ _id: product._id }, { price: 120 });
  const stale = await json('POST', '/orders', { ...payload, expectedQuote: reviewed });
  assert.equal(stale.status, 409);
  const changed = await stale.json();
  assert.equal(changed.code, 'PRICE_CHANGED');
  assert.equal(changed.quote.items[0].price, 120);
  assert.equal(await Order.countDocuments(), count);
  assert.equal((await Product.findById(product._id)).stockCount, 5);
  assert.equal((await Coupon.findById(coupon._id)).usedCount, 0);
  const tampered = structuredClone(changed.quote);
  tampered.pricing.total = 1;
  assert.equal((await json('POST', '/orders', { ...payload, expectedQuote: tampered })).status, 409);
  const accepted = await json('POST', '/orders', { ...payload, expectedQuote: changed.quote });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).order.pricing.total, changed.quote.pricing.total);
  assert.equal((await Product.findById(product._id)).stockCount, 4);
  assert.equal((await Coupon.findById(coupon._id)).usedCount, 1);
});

test('addresses validate additions/edits, preserve identity and maintain the default', async () => {
  const { signToken } = require('../src/services/token.service');
  const user = await User.create({ name: 'Address tester' });
  const token = signToken(user);
  const address = { fullAddress: '12 Main Street', area: 'Central', city: 'Pune', pincode: '411001' };
  assert.equal((await json('POST', '/auth/addresses', { ...address, pincode: 'abc' }, token)).status, 400);
  assert.equal((await json('POST', '/auth/addresses', { ...address, city: ' ' }, token)).status, 400);
  const first = await (await json('POST', '/auth/addresses', address, token)).json();
  const id = first.addresses[0]._id;
  assert.equal(first.addresses[0].isDefault, true);
  assert.equal((await json('PATCH', `/auth/addresses/${id}`, { pincode: '0' }, token)).status, 400);
  const edited = await (await json('PATCH', `/auth/addresses/${id}`, { city: 'Mumbai', pincode: '400001', _id: new mongoose.Types.ObjectId() }, token)).json();
  assert.equal(edited.addresses[0]._id, id);
  assert.equal(edited.addresses[0].city, 'Mumbai');
  const second = await (await json('POST', '/auth/addresses', { ...address, isDefault: true }, token)).json();
  assert.equal(second.addresses.filter((a) => a.isDefault).length, 1);
  const secondId = second.addresses[1]._id;
  const deleted = await (await json('DELETE', `/auth/addresses/${secondId}`, undefined, token)).json();
  assert.equal(deleted.addresses[0].isDefault, true);
});

test('Google identity cannot be overwritten; other profiles validate editable fields', async () => {
  const { signToken } = require('../src/services/token.service');
  const google = await User.create({ name: 'Google Name', email: 'google@example.com', googleId: 'test-google' });
  const token = signToken(google);
  assert.equal((await (await json('GET', '/auth/me', undefined, token)).json()).user.identityReadOnly, true);
  assert.equal((await json('PATCH', '/auth/me', { name: 'Changed' }, token)).status, 400);
  assert.equal((await json('PATCH', '/auth/me', { email: 'other@example.com' }, token)).status, 400);
  assert.equal((await User.findById(google._id)).email, 'google@example.com');
  const customer = await User.create({ name: 'Customer' });
  const customerToken = signToken(customer);
  assert.equal((await json('PATCH', '/auth/me', { email: 'bad' }, customerToken)).status, 400);
  assert.equal((await json('PATCH', '/auth/me', { name: 'Updated', email: '', role: 'admin' }, customerToken)).status, 200);
  assert.equal((await User.findById(customer._id)).role, 'customer');
});

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
