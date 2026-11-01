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
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const { digest, customerWrite } = require('../src/saas/customer-access');
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
let database, server, base, ownerToken, a, b, p, pb, cookieA, cookieB, cookieBob, aliceA, aliceB, bob, request, firstOrder;
const password = 'Local test password!42';
const path = (bakery, suffix = '') => `/saas/storefront/${bakery.slug}/customer${suffix}`;
const ownerPath = (bakery, suffix) => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, { cookie, token, headers = {} } = {}) {
  const expectedCustomer = cookie === cookieA ? aliceA?.id : cookie === cookieB ? aliceB?.id : cookie === cookieBob ? bob?.id : undefined;
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Customer': '1', ...(expectedCustomer ? { 'X-Saas-Customer-Id': expectedCustomer } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
const admin = (method, uri, body) => api(method, uri, body, { token: ownerToken });
const cart = () => ({ items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 19900 }], comment: 'Pickup please' });
const submit = () => ({ ...cart(), expectedReservationMinutes: 30, confirmed: true, idempotencyKey: randomUUID() });
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] });
  await mongoose.connect(database.getUri('saas_customers_test'));
  const owner = await User.create({ name: 'Customer test owner' }); ownerToken = signToken(owner);
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await admin('POST', '/saas/bakeries', { name: 'Customer bakery A', slug: 'customer-a' })).bakery;
  b = (await admin('POST', '/saas/bakeries', { name: 'Customer bakery B', slug: 'customer-b' })).bakery;
  for (const bakery of [a, b]) assert.equal((await admin('PATCH', ownerPath(bakery, 'storefront-settings'), { expectedVersion: 0, published: true, acceptCustomerOrders: true })).status, 200);
  p = (await admin('POST', ownerPath(a, 'products'), { name: 'Cake A', slug: 'cake', category: 'Cakes', pricePaise: 19900, stockCount: 20 })).product;
  pb = (await admin('POST', ownerPath(b, 'products'), { name: 'Cake B', slug: 'cake', category: 'Cakes', pricePaise: 29900, stockCount: 5 })).product;
  const signupA = await api('POST', path(a, '/register'), { email: 'ALICE@example.test', password, displayName: 'Alice A' }); assert.equal(signupA.status, 201, JSON.stringify(signupA)); cookieA = signupA.cookie.split(';')[0]; aliceA = signupA.customer;
  const signupB = await api('POST', path(b, '/register'), { email: 'alice@example.test', password: password + 'B', displayName: 'Alice B' }); assert.equal(signupB.status, 201); cookieB = signupB.cookie.split(';')[0]; aliceB = signupB.customer;
  const signupBob = await api('POST', path(a, '/register'), { email: 'bob@example.test', password, displayName: 'Bob' }); assert.equal(signupBob.status, 201); cookieBob = signupBob.cookie.split(';')[0]; bob = signupBob.customer;
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('the same email has separate bakery accounts, path-scoped sessions and no legacy user/admin access', async () => {
  assert.notEqual(aliceA.id, aliceB.id); assert.equal(aliceA.email, 'alice@example.test'); assert.equal(aliceA.emailVerified, false); assert.equal(await User.countDocuments(), 1);
  const stored = await Customer.findById(aliceA.id).select('+passwordHash').lean(); assert.notEqual(stored.passwordHash, password); assert.match(stored.passwordHash, /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{128}$/);
  const token = cookieA.split('=')[1], session = await Session.findOne({ customerId: aliceA.id }).select('+tokenHash').lean(); assert.equal(session.tokenHash, digest(token)); assert.notEqual(session.tokenHash, token);
  assert.equal((await api('GET', path(a, '/me'), undefined, { cookie: cookieA })).customer.id, aliceA.id);
  assert.equal((await api('GET', path(b, '/me'), undefined, { cookie: cookieA })).status, 401);
  const renamedCookie = cookieB.split('=')[0] + '=' + cookieA.split('=')[1];
  assert.equal((await api('GET', path(b, '/me'), undefined, { cookie: renamedCookie })).status, 401);
  assert.equal((await api('GET', path(a, '/me'), undefined, { token: ownerToken })).status, 401);
  assert.equal((await api('GET', '/saas/bakeries', undefined, { cookie: cookieA })).status, 401);
  assert.equal((await api('POST', path(a, '/login'), { email: 'alice@example.test', password: 'Wrong password that is long' })).status, 401);
  assert.equal((await api('POST', path(b, '/login'), { email: 'alice@example.test', password })).status, 401);
  const login = await api('POST', path(a, '/login'), { email: 'alice@example.test', password }); assert.equal(login.status, 200); assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /SameSite=Strict/); assert.match(login.cookie, /Path=\/api\/saas\/storefront\/customer-a\/customer/); assert.equal(login.customer.passwordHash, undefined); cookieA = login.cookie.split(';')[0];
});
test('customer registration strictly validates fields and rejects cross-origin or form-style login', async () => {
  assert.equal((await api('POST', path(a, '/register'), { email: 'alice@example.test', password, displayName: 'Duplicate' })).status, 409);
  assert.equal((await api('POST', path(a, '/register'), { email: 'new@example.test', password: 'short', displayName: 'Short' })).status, 400);
  assert.equal((await api('POST', path(a, '/register'), { email: 'new@example.test', password, displayName: 'Privilege', role: 'owner' })).status, 400);
  assert.equal((await api('POST', path(a, '/login'), { email: 'alice@example.test', password }, { headers: { 'X-Saas-Customer': '' } })).status, 403);
  assert.equal((await api('POST', path(a, '/login'), { email: 'alice@example.test', password }, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
});
test('a reviewed pickup order reserves authoritative stock once and cannot claim payment or discounts', async () => {
  const quoted = await api('POST', path(a, '/orders/quote'), cart(), { cookie: cookieA }); assert.equal(quoted.status, 200); assert.equal(quoted.quote.totalPaise, 19900); assert.equal(await Order.countDocuments(), 0);
  request = submit(); const results = await Promise.all([api('POST', path(a, '/orders'), request, { cookie: cookieA }), api('POST', path(a, '/orders'), request, { cookie: cookieA })]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 201]); firstOrder = results[0].order; assert.equal(firstOrder.paymentStatus, 'unpaid'); assert.equal(firstOrder.receivedPaise, 0); assert.equal(firstOrder.duePaise, 19900); assert.equal(firstOrder.fulfillment, 'pickup');
  assert.equal((await Product.findById(p._id)).stockCount, 19); assert.equal(await Order.countDocuments(), 1);
  for (const key of ['costSnapshot', 'customerId', 'actorId', 'requestHash', 'idempotencyKey', 'comment', 'eventId']) assert.equal(firstOrder[key], undefined);
  assert.equal(firstOrder.items[0].stockClaimed, undefined);
  for (const extra of [{ paymentStatus: 'paid' }, { discountPaise: 19900 }, { eventId: String(new mongoose.Types.ObjectId()) }, { customerId: bob.id }, { totalPaise: 0 }]) assert.equal((await api('POST', path(a, '/orders'), { ...submit(), ...extra }, { cookie: cookieA })).status, 400);
  assert.equal((await api('POST', path(a, '/orders/quote'), { items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 0 }] }, { cookie: cookieA })).status, 409);
  const visible = await admin('GET', ownerPath(a, `orders/${firstOrder._id}`)); assert.equal(visible.order.source, 'storefront'); assert.equal(visible.order.customerId, undefined);
});
test('customer histories, item references and submission keys cannot cross customer or bakery boundaries', async () => {
  assert.equal((await api('GET', path(a, `/orders/${firstOrder._id}`), undefined, { cookie: cookieBob })).status, 404);
  assert.equal((await api('GET', path(b, `/orders/${firstOrder._id}`), undefined, { cookie: cookieB })).status, 404);
  assert.equal((await api('GET', path(a, '/orders'), undefined, { cookie: cookieBob })).orders.length, 0);
  const changedSession = await api('GET', path(a, '/orders'), undefined, { cookie: cookieA, headers: { 'X-Saas-Customer-Id': bob.id } }); assert.equal(changedSession.status, 409); assert.equal(changedSession.details.code, 'CUSTOMER_SESSION_CHANGED');
  assert.equal((await api('POST', path(a, '/logout'), {}, { cookie: cookieA, headers: { 'X-Saas-Customer-Id': bob.id } })).status, 409);
  assert.equal((await api('GET', path(a, '/me'), undefined, { cookie: cookieA })).customer.id, aliceA.id);
  assert.equal((await api('GET', path(a, '/orders') + '?customerId=' + aliceA.id, undefined, { cookie: cookieBob })).status, 400);
  const conflict = await api('POST', path(a, '/orders'), request, { cookie: cookieBob }); assert.equal(conflict.status, 409); assert.equal(conflict.details.code, 'SALE_KEY_CONFLICT'); assert.equal(conflict.details.orderId, undefined);
  assert.equal((await api('POST', path(a, '/orders/quote'), { items: [{ productId: pb._id, quantity: 1, expectedUnitPricePaise: 29900 }] }, { cookie: cookieA })).status, 409);
});
test('pausing/unpublishing blocks new pickup orders while saved retries and owned history remain accessible', async () => {
  assert.equal((await admin('PATCH', ownerPath(a, 'storefront-settings'), { expectedVersion: 1, published: false, acceptCustomerOrders: false })).status, 200);
  assert.equal((await api('POST', path(a, '/orders'), request, { cookie: cookieA })).replayed, true);
  const rejected = await api('POST', path(a, '/orders'), submit(), { cookie: cookieA }); assert.equal(rejected.status, 409); assert.equal(rejected.details.code, 'SALE_REJECTED');
  assert.equal((await api('GET', path(a, '/orders'), undefined, { cookie: cookieA })).orders.length, 1);
  assert.equal((await api('POST', path(a, '/register'), { email: 'paused@example.test', password, displayName: 'Paused' })).status, 409);
  assert.equal((await admin('PATCH', ownerPath(a, 'storefront-settings'), { expectedVersion: 2, published: true, acceptCustomerOrders: true })).status, 200);
});
test('unpaid customer order caps are atomic and manual receipt releases a slot', async () => {
  const results = await Promise.all([api('POST', path(a, '/orders'), submit(), { cookie: cookieA }), api('POST', path(a, '/orders'), submit(), { cookie: cookieA })]); assert.deepEqual(results.map(row => row.status), [201, 201]);
  assert.equal((await api('POST', path(a, '/orders'), submit(), { cookie: cookieA })).status, 409);
  assert.equal((await admin('POST', ownerPath(a, `orders/${firstOrder._id}/settle`), { expectedVersion: 1, confirmed: true, paymentMethod: 'cash' })).status, 200);
  assert.equal((await api('GET', path(a, `/orders/${firstOrder._id}`), undefined, { cookie: cookieA })).order.paymentStatus, 'paid');
  assert.equal((await api('POST', path(a, '/orders'), submit(), { cookie: cookieA })).status, 201);
});
test('failed customer order persistence rolls back the reservation, number and order', async () => {
  const stock = (await Product.findById(p._id)).stockCount, count = await Order.countDocuments(); const original = Audit.create; Audit.create = async () => { throw new Error('Synthetic customer order audit failure'); };
  try { assert.equal((await api('POST', path(a, '/orders'), submit(), { cookie: cookieBob })).status, 500); } finally { Audit.create = original; }
  assert.equal((await Product.findById(p._id)).stockCount, stock); assert.equal(await Order.countDocuments(), count); assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0);
});
test('logout, expiry and customer deactivation revoke scoped access without changing staff sessions', async () => {
  const logout = await api('POST', path(a, '/logout'), {}, { cookie: cookieA }); assert.equal(logout.status, 200); assert.match(logout.cookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api('GET', path(a, '/me'), undefined, { cookie: cookieA })).status, 401);
  assert.equal((await api('POST', path(a, '/logout'), {}, { cookie: cookieA })).status, 200);
  const bobSession = await Session.findOne({ customerId: bob.id }).lean(); await Session.collection.updateOne({ _id: bobSession._id }, { $set: { expiresAt: new Date(0) } }); assert.equal((await api('GET', path(a, '/me'), undefined, { cookie: cookieBob })).status, 401);
  const bSession = await Session.findOne({ customerId: aliceB.id }).lean(); await Customer.updateOne({ _id: aliceB.id }, { $set: { active: false } });
  assert.equal((await api('GET', path(b, '/me'), undefined, { cookie: cookieB })).status, 401);
  await assert.rejects(() => customerWrite({ bakeryId: b._id, customerId: aliceB.id, sessionId: bSession._id, sessionVersion: bSession.sessionVersion }, () => { throw new Error('Must not run'); }), error => error.statusCode === 401);
  assert.equal((await admin('GET', '/saas/bakeries')).status, 200);
});
test('customer password endpoints are rate limited across bakery slugs', async () => {
  const result = await api('POST', path(b, '/login'), { email: 'alice@example.test', password }); assert.equal(result.status, 429);
});
