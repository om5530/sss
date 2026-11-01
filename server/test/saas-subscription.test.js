process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { subscriptionPolicy, LIMITS } = require('../src/saas/plan-policy');
const { argumentsOf } = require('../src/utils/saas-subscription');
const User = require('../src/models/User');
const Bakery = require('../src/models/Bakery');
const Membership = require('../src/models/BakeryMembership');
const Product = require('../src/models/SaasProduct');
const Change = require('../src/models/SaasSubscriptionChange');
const Audit = require('../src/models/SaasAuditLog');
const Order = require('../src/models/SaasOrder');
const { signToken } = require('../src/services/token.service');
const { changeSubscription } = require('../src/saas/subscription-change');
let database, server, base, token, staffToken, actorId, bakery, other, cookie, customer, p, staffMember, counter, pickup, cancelPickup, serial = 0;
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
const now = () => Date.now();
const iso = offset => new Date(now() + offset).toISOString();
const request = (extra = {}) => ({ planId: 'starter', status: 'active', trialEndsAt: null, currentPeriodEndsAt: iso(86400000), graceEndsAt: null, cancelAtPeriodEnd: false, expectedVersion: 0, idempotencyKey: randomUUID(), reason: 'Local plan test', ...extra });
const path = suffix => `/saas/bakeries/${bakery._id}/${suffix}`;
const store = suffix => `/saas/storefront/${bakery.slug}/customer${suffix}`;
async function api(method, uri, body, identity = 'owner') {
 const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', ...(identity === 'customer' ? { Cookie: cookie, 'X-Saas-Customer': '1', ...(customer ? { 'X-Saas-Customer-Id': customer.id } : {}) } : { Authorization: `Bearer ${identity === 'staff' ? staffToken : token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function change(extra = {}, apply = true) {
 const current = await Bakery.findById(bakery._id).lean(); return changeSubscription({ bakeryId: bakery._id, actorId, body: request({ expectedVersion: current.subscription?.version || 0, ...extra }), apply });
}
before(async () => {
 database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_subscription_test'));
 process.env.SAAS_FOUNDATION_ENABLED = 'true'; const actor = await User.create({ name: 'Local operator' }); actorId = String(actor._id); token = signToken(actor);
 server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
 bakery = (await api('POST', '/saas/bakeries', { name: 'Plan bakery', slug: 'plan-bakery' })).bakery; other = (await api('POST', '/saas/bakeries', { name: 'Other plan bakery', slug: 'plan-other' })).bakery;
 const staff = await User.create({ name: 'Plan staff' }); staffToken = signToken(staff); staffMember = await Membership.create({ bakeryId: bakery._id, userId: staff._id, role: 'staff' });
 p = (await api('POST', path('products'), { name: 'Cake', slug: 'cake', category: 'Cake', pricePaise: 1000, stockCount: 100 })).product;
 await api('PATCH', path('storefront-settings'), { expectedVersion: 0, published: true, acceptCustomerOrders: true });
 const signup = await api('POST', store('/register'), { email: 'plan@example.test', displayName: 'Plan customer', password: 'Local plan password!42' }, 'customer'); assert.equal(signup.status, 201); cookie = signup.cookie.split(';')[0]; customer = signup.customer;
 counter = { items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 1000 }], paymentStatus: 'unpaid', idempotencyKey: randomUUID() };
 assert.equal((await api('POST', path('orders'), counter)).status, 201);
 pickup = { items: [{ productId: p._id, quantity: 1, expectedUnitPricePaise: 1000 }], expectedReservationMinutes: 30, confirmed: true, idempotencyKey: randomUUID() };
 assert.equal((await api('POST', store('/orders'), pickup, 'customer')).status, 201);
 cancelPickup = (await api('POST', store('/orders'), { ...pickup, idempotencyKey: randomUUID() }, 'customer')).order; assert.ok(cancelPickup);
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('policy resolves exact expiry boundaries, bounded grace and unknown states without inventing paid access', () => {
 const date = new Date('2026-10-31T00:00:00.000Z'), future = '2026-11-01T00:00:00.000Z';
 assert.equal(subscriptionPolicy(null, date).access, 'development'); assert.equal(subscriptionPolicy({ planId: 'starter', status: 'trialing', trialEndsAt: future }, date).access, 'trial');
 assert.equal(subscriptionPolicy({ planId: 'starter', status: 'trialing', trialEndsAt: date }, date).access, 'restricted');
 assert.equal(subscriptionPolicy({ planId: 'growth', status: 'active', currentPeriodEndsAt: future, cancelAtPeriodEnd: true }, date).writable, true);
 assert.equal(subscriptionPolicy({ planId: 'growth', status: 'active', currentPeriodEndsAt: date }, date).writable, false);
 assert.equal(subscriptionPolicy({ planId: 'starter', status: 'past_due', currentPeriodEndsAt: date, graceEndsAt: future }, date).access, 'grace');
 assert.equal(subscriptionPolicy({ planId: 'starter', status: 'past_due', currentPeriodEndsAt: date, graceEndsAt: '2026-12-01' }, date).writable, false);
 for (const value of [{ planId: 'constructor', status: 'active', currentPeriodEndsAt: future }, { planId: 'growth', status: 'cancelled', currentPeriodEndsAt: future }, { planId: 'growth', status: 'active' }]) assert.equal(subscriptionPolicy(value, date).writable, false);
 assert.ok(Object.isFrozen(LIMITS));
});
test('operator URI parsing rejects cloud, credentials, remote discovery settings and ambiguous arguments', () => {
 const args = uri => ['--uri', uri, '--bakery-id', bakery._id, '--actor-id', actorId, '--input', '/tmp/example.json'];
 assert.equal(argumentsOf(args('mongodb://127.0.0.1:27017/saas_example?replicaSet=test')).apply, false);
 for (const uri of ['mongodb+srv://cluster/saas_example','mongodb://remote/saas_example','mongodb://127.0.0.1/production','mongodb://user:password@localhost/saas_example','mongodb://localhost/saas_example?directConnection=false','mongodb://localhost/saas_example?replicaSet=a&replicaSet=b']) assert.throws(() => argumentsOf(args(uri)));
 assert.throws(() => argumentsOf([...args('mongodb://localhost/saas_example'), '--apply', '--apply']));
});
test('plan status is owner-only and a dry run changes no bakery, history or audit', async () => {
 const before = await Bakery.findById(bakery._id).lean(), count = await Audit.countDocuments(); const dry = await change({}, false); assert.equal(dry.applied, false); assert.equal(dry.after.version, 1);
 assert.deepEqual(await Bakery.findById(bakery._id).lean(), before); assert.equal(await Change.countDocuments(), 0); assert.equal(await Audit.countDocuments(), count);
 assert.equal((await api('GET', path('subscription'))).access, 'development'); assert.equal((await api('GET', path('subscription'), undefined, 'staff')).status, 403); assert.equal((await api('GET', path('subscription'), undefined, 'customer')).status, 401);
 assert.equal((await api('PATCH', path('subscription'), request())).status, 404); assert.equal((await api('PATCH', `/saas/bakeries/${bakery._id}`, { expectedVersion: 1, subscription: request() })).status, 400);
});
test('applied plan changes are versioned, actor-bound, audited and replay safely', async () => {
 const body = request(); const apply = () => changeSubscription({ bakeryId: bakery._id, actorId, body, apply: true }); const results = await Promise.all([apply(), apply()]); assert.equal(results.filter(r => r.replayed).length, 1);
 assert.equal(await Change.countDocuments(), 1); assert.equal((await Bakery.findById(bakery._id)).subscription.version, 1);
 assert.equal((await Audit.findOne({ action: 'subscription.change' })).actorType, 'platform');
 await assert.rejects(() => changeSubscription({ bakeryId: bakery._id, actorId, body: { ...body, reason: 'Changed' }, apply: true }), e => e.statusCode === 409);
 await assert.rejects(() => changeSubscription({ bakeryId: bakery._id, actorId, body: request({ expectedVersion: 0 }), apply: true }), e => e.statusCode === 409);
 const report = await api('GET', path('subscription')); assert.equal(report.planName, 'Starter preview'); assert.equal(report.billingConnected, false); assert.equal(report.limits.products, 100);
 const history = await api('GET', path('subscription/history')); assert.equal(history.entries.length, 1); for (const key of ['actorId', 'requestHash', 'operationKey', 'bakeryId']) assert.equal(history.entries[0][key], undefined);
 assert.equal((await api('GET', `/saas/bakeries/${other._id}/subscription/history`)).entries.length, 0);
});
test('downgrade limits count archived products and serialize the final available slot', async () => {
 const rows = Array.from({ length: 98 }, () => ({ bakeryId: bakery._id, name: 'Archived', category: 'Cake', pricePaise: 100, slug: `archived-${++serial}`, archived: true })); await Product.insertMany(rows);
 const create = () => api('POST', path('products'), { name: 'Last', slug: `last-${++serial}`, category: 'Cake', pricePaise: 100 });
 const results = await Promise.all([create(), create()]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert.equal((await api('GET', path('usage'))).usage.products.limit, 100);
 await change({ planId: 'growth' }); assert.equal((await create()).status, 201); await change({ planId: 'starter' }); assert.equal((await create()).status, 409);
 assert.equal(await Product.countDocuments({ bakeryId: bakery._id }), 101); assert.equal((await api('PATCH', path(`products/${p._id}`), { expectedVersion: (await Product.findById(p._id)).version, name: 'Price edit at capacity' })).status, 200);
});
test('restricted plans preserve order replay and recovery while rolling general edits back', async () => {
 await change({ status: 'cancelled' }); const before = await Product.findById(p._id).lean(), audits = await Audit.countDocuments();
 const result = await api('PATCH', path(`products/${p._id}`), { expectedVersion: before.version, name: 'Must roll back', stockCount: 90 }); assert.equal(result.status, 409); assert.equal(result.details.code, 'SAAS_SUBSCRIPTION_RESTRICTED');
 assert.deepEqual(await Product.findById(p._id).lean(), before); assert.equal(await Audit.countDocuments(), audits);
 assert.equal((await api('POST', path('orders'), counter)).replayed, true); assert.equal((await api('POST', store('/orders'), pickup, 'customer')).replayed, true);
 const rejected = await api('POST', path('orders'), { ...counter, idempotencyKey: randomUUID() }); assert.equal(rejected.status, 409); assert.equal(rejected.details.code, 'SALE_REJECTED');
 assert.equal((await api('GET', `/saas/storefront/${bakery.slug}`)).orderingEnabled, false);
 assert.equal((await api('POST', store('/orders/quote'), { items: pickup.items }, 'customer')).status, 409);
 const order = await Order.findOne({ bakeryId: bakery._id, source: 'storefront' });
 assert.equal((await api('POST', path(`orders/${order._id}/pickup-status`), { expectedVersion: order.version, confirmed: true, status: 'ready' }, 'staff')).status, 200);
 assert.equal((await api('POST', path(`orders/${order._id}/settle`), { expectedVersion: 2, confirmed: true, paymentMethod: 'cash' }, 'staff')).status, 200);
 assert.equal((await api('POST', path(`orders/${order._id}/pickup-status`), { expectedVersion: 3, confirmed: true, status: 'collected' }, 'staff')).status, 200);
 const cancellation = await api('POST', store(`/orders/${cancelPickup._id}/cancel`), { expectedVersion: 1, confirmed: true, reason: 'Cancelled while restricted' }, 'customer'); assert.equal(cancellation.status, 200);
 assert.equal((await api('POST', path('orders/expire-reservations'), { confirmed: true })).status, 200);
 const counterOrder = await Order.findOne({ bakeryId: bakery._id, source: 'counter' });
 assert.equal((await api('POST', path(`orders/${counterOrder._id}/settle`), { expectedVersion: 1, confirmed: true, paymentMethod: 'cash' })).status, 200);
 assert.equal((await api('PATCH', path(`orders/${counterOrder._id}/discount`), { expectedVersion: 2, confirmed: true, discountPaise: 1000, reason: 'Manual goodwill correction' })).status, 200);
 assert.equal((await api('POST', path(`orders/${counterOrder._id}/refund`), { expectedVersion: 3, confirmed: true, expectedRefundPaise: 1000, paymentMethod: 'cash', reason: 'Money already returned manually', idempotencyKey: randomUUID() })).status, 200);
 assert.equal((await api('POST', path(`members/${staffMember._id}/revoke`), { expectedVersion: 1, confirmed: true })).status, 200);
 assert.equal((await api('GET', path('subscription'), undefined, 'staff')).status, 404);
 assert.equal((await api('GET', store('/orders'), undefined, 'customer')).status, 200); assert.equal((await api('POST', store('/logout'), {}, 'customer')).status, 200);
});
test('a failed subscription audit rolls state and history back and local guards cannot be bypassed', async () => {
 const before = await Bakery.findById(bakery._id).lean(), count = await Change.countDocuments(), original = Audit.create; Audit.create = async () => { throw new Error('Synthetic subscription audit failure'); };
 try { await assert.rejects(() => change({ planId: 'growth' }), /Synthetic subscription/); } finally { Audit.create = original; }
 assert.deepEqual(await Bakery.findById(bakery._id).lean(), before); assert.equal(await Change.countDocuments(), count);
 process.env.VERCEL = '1'; try { await assert.rejects(() => change(), e => e.statusCode === 403); } finally { delete process.env.VERCEL; }
 assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0); assert.equal(await mongoose.connection.collection('products').countDocuments(), 0);
});

test('invalid plan fields, ambiguous dates and excessive grace are rejected before mutation', async () => {
 const { inputOf } = require('../src/saas/subscription-change');
 for (const extra of [{ planId: ['starter'] }, { planId: 'enterprise' }, { status: 'active', currentPeriodEndsAt: null }, { status: 'trialing', trialEndsAt: null }, { status: 'trialing', trialEndsAt: '2026-02-30T00:00:00.000Z' }, { graceEndsAt: iso(86400000) }, { status: 'past_due', currentPeriodEndsAt: iso(-864000000), graceEndsAt: iso(86400000) }, { limits: { products: 9999999 } }, { expectedVersion: Number.MAX_SAFE_INTEGER }, { status: 'cancelled', cancelAtPeriodEnd: true }]) assert.throws(() => inputOf(request(extra)), e => e.statusCode === 400);
});
test('the real operator command defaults to dry run, applies explicitly and replays the same operation', async () => {
 const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'); const { execFile } = require('node:child_process'); const { promisify } = require('node:util');
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saas-plan-cli-')), file = path.join(directory, 'request.json');
 try {
  await fs.writeFile(file, JSON.stringify(request()));
  const args = [path.resolve(__dirname, '../src/utils/saas-subscription.js'), '--uri', database.getUri('saas_subscription_test'), '--bakery-id', other._id, '--actor-id', actorId, '--input', file];
  const run = async (flags = []) => JSON.parse((await promisify(execFile)(process.execPath, [...args, ...flags], { env: { ...process.env, NODE_ENV: 'test', SAAS_FOUNDATION_ENABLED: 'true', MONGODB_URI: 'mongodb://remote/production' }, timeout: 15000 })).stdout);
  assert.equal((await run()).applied, false); assert.equal((await Bakery.findById(other._id)).subscription, undefined);
  assert.equal((await run(['--apply'])).applied, true); assert.equal((await run(['--apply'])).replayed, true); assert.equal((await Bakery.findById(other._id)).subscription.version, 1);
  assert.equal(await Change.countDocuments({ bakeryId: other._id }), 1);
 } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('restriction changes and general writes serialize through the same bakery lock', async () => {
 await change({ planId: 'growth', status: 'active' }); const count = await Product.countDocuments({ bakeryId: bakery._id });
 const [update, creation] = await Promise.all([change({ status: 'cancelled' }), api('POST', path('products'), { name: 'Racing plan change', slug: 'plan-race', category: 'Cake', pricePaise: 100 })]);
 assert.equal(update.applied, true); assert.ok([201, 409].includes(creation.status)); assert.equal(await Product.countDocuments({ bakeryId: bakery._id }), count + (creation.status === 201 ? 1 : 0));
 assert.equal((await api('GET', path('subscription'))).access, 'restricted');
 const failed = await api('POST', path('products'), { name: 'After restriction', slug: 'after-restriction', category: 'Cake', pricePaise: 100 }); assert.equal(failed.status, 409);
});
