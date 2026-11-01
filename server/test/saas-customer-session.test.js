process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Customer = require('../src/models/SaasCustomer');
const Session = require('../src/models/SaasCustomerSession');
const Product = require('../src/models/SaasProduct');
const Order = require('../src/models/SaasOrder');
const Movement = require('../src/models/SaasStockMovement');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, ownerToken, bakery, customer, originalCookie, cookie, product;
const password = 'Only local session test!';
const path = suffix => `/saas/storefront/sessions/customer${suffix}`;
async function api(method, uri, body, cookieValue) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Customer': '1', ...(customer ? { 'X-Saas-Customer-Id': customer.id } : {}), ...(cookieValue ? { Cookie: cookieValue } : {}), ...(ownerToken ? { Authorization: `Bearer ${ownerToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_customer_sessions_test'));
  ownerToken = signToken(await User.create({ name: 'Session test owner' })); process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  bakery = (await api('POST', '/saas/bakeries', { name: 'Session bakery', slug: 'sessions' })).bakery;
  assert.equal((await api('PATCH', `/saas/bakeries/${bakery._id}/storefront-settings`, { expectedVersion: 0, published: true, acceptCustomerOrders: true })).status, 200);
  product = (await api('POST', `/saas/bakeries/${bakery._id}/products`, { name: 'Last piece', slug: 'last-piece', category: 'Cakes', pricePaise: 1000, stockCount: 1 })).product;
  const signup = await api('POST', path('/register'), { email: 'sessions@example.test', password, displayName: 'Session customer' }); assert.equal(signup.status, 201); customer = signup.customer; cookie = originalCookie = signup.cookie.split(';')[0];
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('a sixth sign-in evicts the oldest session while retaining only five scoped tokens', async () => {
  for (let i = 0; i < 5; i++) { const result = await api('POST', path('/login'), { email: customer.email, password }); assert.equal(result.status, 200); cookie = result.cookie.split(';')[0]; }
  assert.equal(await Session.countDocuments({ bakeryId: bakery._id, customerId: customer.id }), 5);
  assert.equal((await api('GET', path('/me'), undefined, originalCookie)).status, 401); assert.equal((await api('GET', path('/me'), undefined, cookie)).customer.id, customer.id);
});
test('a failed registration audit leaves no account or session behind', async () => {
  const count = await Customer.countDocuments(), sessions = await Session.countDocuments(), original = Audit.create; Audit.create = async () => { throw new Error('Synthetic signup audit failure'); };
  try { assert.equal((await api('POST', path('/register'), { email: 'rollback@example.test', password, displayName: 'Rollback' })).status, 500); } finally { Audit.create = original; }
  assert.equal(await Customer.countDocuments(), count); assert.equal(await Session.countDocuments(), sessions); assert.equal(await User.countDocuments(), 1);
  assert.equal((await api('POST', path('/login'), { email: 'rollback@example.test', password })).status, 401);
});
test('logout and order placement serialize so revocation cannot leave a partial reservation', async () => {
  const request = { items: [{ productId: product._id, quantity: 1, expectedUnitPricePaise: 1000 }], comment: '', expectedReservationMinutes: 30, confirmed: true, idempotencyKey: randomUUID() };
  const [placed, logout] = await Promise.all([api('POST', path('/orders'), request, cookie), api('POST', path('/logout'), {}, cookie)]);
  assert.ok([201, 401].includes(placed.status), JSON.stringify(placed)); assert.equal(logout.status, 200); const saved = await Order.countDocuments(); assert.equal(saved, placed.status === 201 ? 1 : 0);
  assert.equal((await Product.findById(product._id)).stockCount, 1 - saved); assert.equal((await api('GET', path('/me'), undefined, cookie)).status, 401);
  if (saved) assert.equal((await Movement.findOne({ orderId: placed.order._id }).lean()).actorType, 'customer');
});
