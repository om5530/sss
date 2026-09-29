process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const Payment = require('../src/models/Payment');
let mongod, server, base, adminToken, customerToken, product, adminId;
const json = (method, path, body, token = adminToken) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
async function payload(overrides = {}) {
  const items = overrides.items || [{ productId: String(product._id), quantity: 2 }];
  const orderType = overrides.orderType || 'takeaway';
  const quote = await json('POST', '/admin/orders/quote', { items, orderType, discount: overrides.discount ?? 0 });
  assert.equal(quote.status, 200);
  return { requestKey: crypto.randomUUID(), items, orderType, discount: overrides.discount ?? 0, source: 'event', eventName: 'Diwali Fair 2026',
    customer: { name: '', phone: '' }, notes: '', paymentMethod: 'upi', paymentStatus: 'paid', orderStatus: 'completed',
    expectedQuote: await quote.json(), ...overrides };
}
async function create(overrides = {}) {
  const body = await payload(overrides);
  const response = await json('POST', '/admin/orders', body);
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  if ((body.paymentMethod || 'upi') === 'upi' && body.paymentStatus === 'paid') {
    assert.equal(result.order.paymentStatus, 'pending');
    const settled = await json('POST', '/admin/orders/' + result.order._id + '/settle-manual', {});
    assert.equal(settled.status, 200);
    return (await settled.json()).order;
  }
  return result.order;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = require('../src/app').listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api';
  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  const admin = await User.create({ name: 'Manual order admin', role: 'admin' });
  adminId = String(admin._id); adminToken = signToken(admin);
  customerToken = signToken(await User.create({ name: 'Customer' }));
  product = await Product.create({ name: 'Event Brownie', slug: 'event-brownie', group: 'bakery', category: 'Brownies', price: 100, available: true });
  await Order.init();
});
after(async () => { await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); await mongod.stop(); });

test('manual creation, quotes, settlement and event reports require admin access', async () => {
  for (const token of [null, customerToken]) {
    for (const [method, path, body] of [
      ['POST', '/admin/orders', {}], ['POST', '/admin/orders/quote', {}],
      ['POST', '/admin/orders/' + new mongoose.Types.ObjectId() + '/settle-manual', {}], ['GET', '/admin/reports/events'],
      ['GET', '/admin/orders/' + new mongoose.Types.ObjectId() + '/upi-qr'],
    ]) assert.equal((await json(method, path, body, token)).status, token ? 403 : 401);
  }
});

test('event counter sale has optional customer details, authoritative INR prices and a manual payment record', async () => {
  const order = await create({ pricing: { total: 1 }, paymentMethod: undefined });
  assert.equal(order.source, 'event'); assert.equal(order.eventName, 'Diwali Fair 2026');
  assert.equal(order.user, null); assert.equal(order.createdBy, adminId);
  assert.equal(order.pricing.total, 210); assert.equal(order.pricing.currency, 'inr');
  assert.equal(order.orderStatus, 'completed'); assert.equal(order.paymentStatus, 'paid');
  const payment = await Payment.findOne({ order: order._id });
  assert.equal(payment.provider, 'manual'); assert.equal(payment.method, 'upi');
  assert.equal(payment.status, 'succeeded'); assert.equal(payment.amount, 210); assert.equal(payment.mock, false);
  const active = await (await json('GET', '/admin/orders?active=true')).json();
  assert.ok(!active.orders.some((o) => o._id === order._id));
});

test('staff discount changes the saved total, payment amount and UPI QR only when applied', async () => {
  const zeroQuote = await (await json('POST', '/admin/orders/quote', {
    items: [{ productId: String(product._id), quantity: 2 }], orderType: 'takeaway', discount: 0,
  })).json();
  assert.equal(zeroQuote.pricing.discount, 0);
  assert.equal(zeroQuote.pricing.total, 210);

  const discounted = await create({ discount: 20, paymentStatus: 'pending' });
  assert.equal(discounted.pricing.subtotal, 200);
  assert.equal(discounted.pricing.discount, 20);
  assert.equal(discounted.pricing.tax, 9);
  assert.equal(discounted.pricing.total, 189);
  assert.equal((await Payment.findOne({ order: discounted._id })).amount, 189);
  const qr = await (await json('GET', '/admin/orders/' + discounted._id + '/upi-qr')).json();
  assert.equal(qr.payment.amount, 189);
  assert.equal(qr.payment.discount, 20);
  assert.equal(new URL(qr.payment.uri).searchParams.get('am'), '189.00');

  for (const discount of [-1, 200.01, 20.001]) {
    const response = await json('POST', '/admin/orders/quote', {
      items: [{ productId: String(product._id), quantity: 2 }], orderType: 'takeaway', discount,
    });
    assert.equal(response.status, 400, String(discount));
  }
  const forged = await payload({ discount: 20 });
  assert.equal((await json('POST', '/admin/orders', { ...forged, discount: 25 })).status, 409);
});

test('phone delivery can be entered without an account and appears in queue, search and prep with instructions', async () => {
  const order = await create({ source: 'phone', eventName: '', orderType: 'delivery', orderStatus: 'confirmed', paymentStatus: 'pending',
    customer: { name: 'Phone Customer', phone: '+919876543210' }, notes: 'Pack separately',
    delivery: { fullAddress: '15 Test Road', area: 'Dahisar', city: 'Mumbai', pincode: '400068' } });
  assert.equal(order.user, null); assert.equal(order.pricing.total, 250);
  const byAmount = await (await json('GET', '/admin/orders?amount=250')).json();
  assert.ok(byAmount.orders.some((o) => o._id === order._id));
  assert.ok(byAmount.orders.every((o) => o.pricing.total === 250));
  const bySearch = await (await json('GET', '/admin/orders?q=250')).json();
  assert.ok(bySearch.orders.some((o) => o._id === order._id));
  const byCurrencySearch = await (await json('GET', '/admin/orders?q=%E2%82%B9250')).json();
  assert.ok(byCurrencySearch.orders.some((o) => o._id === order._id));
  assert.ok(byCurrencySearch.orders.every((o) => o.pricing.total === 250));
  assert.equal((await json('GET', '/admin/orders?amount=250.001')).status, 400);
  const active = await (await json('GET', '/admin/orders?active=true&source=phone')).json();
  assert.ok(active.orders.some((o) => o._id === order._id));
  const search = await (await json('GET', '/admin/orders?q=9876543210')).json();
  assert.ok(search.orders.some((o) => o._id === order._id));
  const prep = await (await json('GET', '/admin/reports/prep')).json();
  const row = prep.orders.find((o) => o._id === order._id);
  assert.equal(row.notes, 'Pack separately'); assert.equal(row.customer.name, 'Phone Customer');
  assert.equal(row.source, 'phone');
  assert.equal((await json('GET', '/orders/' + order._id, undefined, null)).status, 403);
  assert.equal((await json('POST', '/payments/' + order._id + '/intent', {}, null)).status, 403);
  const paid = await json('POST', '/admin/orders/' + order._id + '/settle-manual', {});
  assert.equal(paid.status, 200); assert.equal((await paid.json()).order.paymentStatus, 'paid');
  assert.equal((await json('POST', '/admin/orders/' + order._id + '/settle-manual', {})).status, 409);
});

test('manual phone and delivery orders accept omitted, blank or partial customer details', async () => {
  for (const customer of [undefined, { name: '', phone: '' }, { name: 'Name only' }, { phone: '9876543210' }]) {
    for (const orderType of ['takeaway', 'delivery']) {
      const order = await create({ source: 'phone', eventName: '', orderType, customer, paymentStatus: 'pending',
        delivery: orderType === 'delivery' ? { fullAddress: 'Test Road', area: 'Dahisar', city: 'Mumbai', pincode: '400068' } : undefined });
      assert.equal(order.customer.name, customer?.name || '');
      assert.equal(order.customer.phone, customer?.phone || '');
      assert.equal(order.paymentStatus, 'pending');
      assert.equal((await json('GET', '/admin/orders/' + order._id + '/upi-qr')).status, 200);
    }
  }
});

test('stock is claimed once across retries and returned on cancellation', async () => {
  const tracked = await Product.create({ name: 'Limited Bake', slug: 'limited-bake', group: 'bakery', category: 'Bakes', price: 50, available: true, stockCount: 2 });
  const body = await payload({ items: [{ productId: String(tracked._id), quantity: 2 }], orderStatus: 'confirmed', paymentStatus: 'pending' });
  const first = await json('POST', '/admin/orders', body);
  assert.equal(first.status, 201); const order = (await first.json()).order;
  assert.equal((await Product.findById(tracked._id)).stockCount, 0);
  assert.equal((await Product.findById(tracked._id)).available, false);
  const retry = await json('POST', '/admin/orders', body);
  assert.equal(retry.status, 200); assert.equal((await retry.json()).order._id, order._id);
  assert.equal(await Payment.countDocuments({ order: order._id }), 1);
  assert.equal((await Product.findById(tracked._id)).stockCount, 0);
  assert.equal((await json('POST', '/admin/orders', { ...body, notes: 'Different sale' })).status, 409);
  const cancelled = await json('PATCH', '/admin/orders/' + order._id + '/status', { status: 'cancelled', note: 'Customer changed their mind' });
  assert.equal(cancelled.status, 200);
  assert.equal((await Product.findById(tracked._id)).stockCount, 2);
  assert.equal((await Product.findById(tracked._id)).available, true);
  assert.equal((await json('POST', '/admin/orders/' + order._id + '/settle-manual', {})).status, 409);
});

test('changed prices and invalid manual fields never create orders or claim stock', async () => {
  const body = await payload(); const count = await Order.countDocuments();
  await Product.updateOne({ _id: product._id }, { $set: { price: 120 } });
  const changed = await json('POST', '/admin/orders', body);
  assert.equal(changed.status, 409); const conflict = await changed.json();
  assert.equal(conflict.code, 'PRICE_CHANGED'); assert.equal(conflict.quote.pricing.total, 252);
  await Product.updateOne({ _id: product._id }, { $set: { price: 100 } });
  for (const overrides of [{ source: 'website' }, { eventName: ' ' }, { customer: { name: 7 } },
    { paymentMethod: 'online' }, { paymentMethod: 'card' }, { paymentStatus: 'refunded' }, { customer: { phone: 'invalid' } },
    { items: [{ productId: String(product._id), quantity: -1 }] }, { items: [{ productId: 'invalid', quantity: 1 }] },
    { notes: 'x'.repeat(1001) }, { fulfilAt: new Date(Date.now() + 3600000).toISOString() }]) {
    assert.equal((await json('POST', '/admin/orders', { ...body, requestKey: crypto.randomUUID(), ...overrides })).status, 400, JSON.stringify(overrides));
  }
  assert.equal(await Order.countDocuments(), count);
});

test('failed payment or order persistence rolls back stock and restores product availability', async (t) => {
  const tracked = await Product.create({ name: 'Rollback Bake', slug: 'rollback-bake', group: 'bakery', category: 'Bakes', price: 75, available: true, stockCount: 1 });
  const body = await payload({ items: [{ productId: String(tracked._id), quantity: 1 }] });
  const paymentsBefore = await Payment.countDocuments();
  const original = Order.prototype.save;
  const mocked = t.mock.method(Order.prototype, 'save', async function (...args) {
    if (this.source === 'event') throw new Error('Test write failure');
    return original.apply(this, args);
  });
  assert.equal((await json('POST', '/admin/orders', body)).status, 500);
  mocked.mock.restore();
  assert.equal((await Product.findById(tracked._id)).stockCount, 1);
  assert.equal((await Product.findById(tracked._id)).available, true);
  assert.equal(await Payment.countDocuments(), paymentsBefore);
  const paymentMock = t.mock.method(Payment, 'create', async () => { throw new Error('Test payment failure'); });
  assert.equal((await json('POST', '/admin/orders', body)).status, 500);
  paymentMock.mock.restore();
  assert.equal((await Product.findById(tracked._id)).stockCount, 1);
  assert.equal((await Product.findById(tracked._id)).available, true);
});

test('event reports group event names and split received payments, excluding unpaid, cancelled and refunded sales', async () => {
  const eventName = 'Annual  Fair';
  const cash = await create({ eventName, paymentMethod: 'cash' });
  await create({ eventName: 'annual fair', paymentMethod: 'upi' });
  await create({ eventName: 'Annual Fair', paymentMethod: 'upi' });
  const due = await create({ eventName: 'Annual Fair', paymentStatus: 'pending' });
  const refund = await create({ eventName: 'Annual Fair' });
  assert.equal((await json('POST', '/admin/orders/' + refund._id + '/refund', { reason: 'Returned at stall' })).status, 200);
  assert.equal((await Payment.findOne({ order: refund._id })).status, 'refunded');
  const cancelled = await create({ eventName: 'Annual Fair', orderStatus: 'confirmed' });
  assert.equal((await json('PATCH', '/admin/orders/' + cancelled._id + '/status', { status: 'cancelled', note: 'Cancelled' })).status, 200);
  const report = await (await json('GET', '/admin/reports/events?eventName=Annual%20Fair')).json();
  assert.equal(report.events.length, 1); const event = report.events[0];
  assert.equal(event.orders, 6); assert.equal(event.paidOrders, 3); assert.equal(event.units, 6);
  assert.equal(event.revenue, 630); assert.equal(event.cash, 210); assert.equal(event.upi, 420); assert.equal(event.card, 0);
  assert.equal(event.pendingAmount, 210); assert.equal(report.products[0].quantity, 6); assert.equal(report.products[0].subtotal, 600);
  const list = await (await json('GET', '/admin/orders?source=event&eventName=Annual%20Fair')).json();
  assert.equal(list.total, 6); assert.ok(list.orders.some((o) => o._id === cash._id));
  assert.equal((await json('POST', '/admin/orders/' + due._id + '/settle-manual', {})).status, 200);
  const updated = await (await json('GET', '/admin/reports/events?eventName=Annual%20Fair')).json();
  assert.equal(updated.events[0].revenue, 840); assert.equal(updated.events[0].pendingAmount, 0);
  assert.equal(updated.products[0].quantity, 8);
});

test('simultaneous sales cannot oversell tracked stock and duplicate submissions do not persist twice', async () => {
  const tracked = await Product.create({ name: 'Last Bake', slug: 'last-bake', group: 'bakery', category: 'Bakes', price: 25, available: true, stockCount: 1 });
  const body = await payload({ items: [{ productId: String(tracked._id), quantity: 1 }] });
  const responses = await Promise.all([json('POST', '/admin/orders', body), json('POST', '/admin/orders', body)]);
  assert.ok(responses.some((r) => r.status === 201));
  assert.ok(responses.every((r) => [200, 201, 409].includes(r.status)));
  assert.equal(await Order.countDocuments({ 'items.product': tracked._id }), 1);
  assert.equal((await Product.findById(tracked._id)).stockCount, 0);
  const retry = await json('POST', '/admin/orders', body); assert.equal(retry.status, 200);
});

test('personal UPI QR uses saved total and default Harshita account without marking payment received', async () => {
  const body = await payload({ orderType: 'delivery', customer: { name: 'QR Customer', phone: '9876543210' },
    delivery: { fullAddress: 'Test Road', area: 'Dahisar', city: 'Mumbai', pincode: '400068' } });
  const created = await json('POST', '/admin/orders', body);
  assert.equal(created.status, 201);
  const order = (await created.json()).order;
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.upiRecipient.id, 'harshita');
  const response = await json('GET', '/admin/orders/' + order._id + '/upi-qr?amount=1');
  assert.equal(response.status, 200);
  const payment = (await response.json()).payment;
  const uri = new URL(payment.uri);
  assert.equal(uri.searchParams.get('pa'), 'harshi.menghani-1@okaxis');
  assert.equal(uri.searchParams.get('pn'), 'Harshita Menghani');
  assert.equal(uri.searchParams.get('am'), '250.00');
  assert.equal(uri.searchParams.get('cu'), 'INR');
  assert.equal(uri.searchParams.get('tr'), order.orderNumber);
  assert.equal(uri.searchParams.has('mc'), false);
  assert.equal((await Order.findById(order._id)).paymentStatus, 'pending');
  assert.equal((await Payment.findOne({ order: order._id })).status, 'requires_payment');
  assert.equal((await json('POST', '/admin/orders/' + order._id + '/settle-manual', {})).status, 200);
  assert.equal((await json('GET', '/admin/orders/' + order._id + '/upi-qr')).status, 409);
});

test('UPI recipient selection and saved account survive configuration changes; invalid settings are rejected', async () => {
  const omkar = await create({ paymentStatus: 'pending', upiRecipientId: 'omkar' });
  const aarchita = await create({ paymentStatus: 'pending', upiRecipientId: 'aarchita' });
  assert.equal(aarchita.upiRecipient.upiId, 'aarchita.menghani@okaxis');
  assert.equal(aarchita.upiRecipient.payeeName, 'Aarchita Menghani');
  const settings = (await (await json('GET', '/admin/settings')).json()).settings;
  const changed = settings.upiRecipients.map(r => r.id === 'omkar' ? { ...r, upiId: 'different@oksbi' } : r);
  assert.equal((await json('PATCH', '/admin/settings', { upiRecipients: changed, defaultUpiRecipientId: 'aarchita' })).status, 200);
  const qr = (await (await json('GET', '/admin/orders/' + omkar._id + '/upi-qr')).json()).payment;
  assert.equal(new URL(qr.uri).searchParams.get('pa'), 'omkarbacha25-2@oksbi');
  const newDefault = await create({ paymentStatus: 'pending' });
  assert.equal(newDefault.upiRecipient.id, 'aarchita');
  for (const rows of [changed.slice(1), [changed[0], changed[0], changed[2]],
    changed.map(r => r.id === 'omkar' ? { ...r, upiId: 'x@oksbi&am=1' } : r)]) {
    assert.equal((await json('PATCH', '/admin/settings', { upiRecipients: rows })).status, 400);
  }
  const blank = changed.map(r => r.id === 'omkar' ? { ...r, upiId: '' } : r);
  assert.equal((await json('PATCH', '/admin/settings', { upiRecipients: blank, defaultUpiRecipientId: 'omkar' })).status, 400);
  assert.equal((await json('PATCH', '/admin/settings', { upiRecipients: blank, defaultUpiRecipientId: 'harshita' })).status, 200);
  const before = await Order.countDocuments();
  assert.equal((await json('POST', '/admin/orders', await payload({ upiRecipientId: 'omkar' }))).status, 400);
  assert.equal(await Order.countDocuments(), before);
  assert.equal((await json('PATCH', '/admin/settings', { upiRecipients: settings.upiRecipients, defaultUpiRecipientId: settings.defaultUpiRecipientId })).status, 200);
  const cash = await create({ paymentMethod: 'cash' });
  assert.equal((await json('GET', '/admin/orders/' + cash._id + '/upi-qr')).status, 400);
  const cancelled = await create({ paymentStatus: 'pending', orderStatus: 'confirmed' });
  assert.equal((await json('PATCH', '/admin/orders/' + cancelled._id + '/status', { status: 'cancelled', note: 'Cancelled' })).status, 200);
  assert.equal((await json('GET', '/admin/orders/' + cancelled._id + '/upi-qr')).status, 409);
});
