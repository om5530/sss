process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Bakery = require('../src/models/Bakery');
const Membership = require('../src/models/BakeryMembership');
const Checkout = require('../src/models/SaasBillingCheckout');
const Invoice = require('../src/models/SaasBillingInvoice');
const Event = require('../src/models/SaasBillingEvent');
const Change = require('../src/models/SaasSubscriptionChange');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const billing = require('../src/saas/billing');
const provider = require('../src/saas/billing-provider');
const { changeSubscription } = require('../src/saas/subscription-change');
const oldFetch = global.fetch, oldFlag = process.env.SAAS_FOUNDATION_ENABLED;
const values = { SAAS_RAZORPAY_TEST_ENABLED: 'true', SAAS_RAZORPAY_TEST_KEY_ID: 'rzp_test_fixture', SAAS_RAZORPAY_TEST_KEY_SECRET: 'synthetic-key-secret-no-money', SAAS_RAZORPAY_TEST_WEBHOOK_SECRET: 'synthetic-webhook-secret-for-local-tests-only', SAAS_RAZORPAY_TEST_ACCOUNT_ID: 'acc_fixture', SAAS_RAZORPAY_TEST_STARTER_PLAN: 'plan_starter', SAAS_RAZORPAY_TEST_GROWTH_PLAN: 'plan_growth' };
const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
let database, server, base, token, staffToken, outsiderToken, actorId, a, b, context, sub, invoiceRows, payment, createCount = 0, serial = 0, failCreate = false, failCancel = false, tamper = false;
const expectedAmountPaise = 49900;
const body = (extra = {}) => ({ planId: 'starter', expectedAmountPaise, idempotencyKey: randomUUID(), confirmed: true, ...extra });
const path = suffix => `/saas/bakeries/${a._id}/billing${suffix}`;
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
async function api(method, path, value, auth = token) { const r = await oldFetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: value === undefined ? undefined : JSON.stringify(value) }); return { status: r.status, ...await r.json() }; }
async function create(extra = {}) { const result = await api('POST', path('/checkout'), body(extra)); assert.equal(result.status, 200, JSON.stringify(result)); return result.checkout; }
function paid(status = 'active') {
 const start = Math.floor(Date.now() / 1000) - 86400, end = start + 30 * 86400;
 sub.status = status; sub.paid_count = 1; sub.current_start = start; sub.current_end = end;
 invoiceRows = [{ id: 'inv_cycle', subscription_id: sub.id, currency: 'INR', status: 'paid', amount: expectedAmountPaise, amount_paid: expectedAmountPaise, amount_due: 0, billing_start: start, billing_end: end, payment_id: 'pay_cycle', short_url: 'https://rzp.io/i/invoice' }];
 payment = { id: 'pay_cycle', invoice_id: 'inv_cycle', currency: 'INR', status: 'captured', captured: true, amount: expectedAmountPaise, amount_refunded: 0 };
}
async function webhook(id = 'evt_first', event = 'subscription.charged', mutate = {}) {
 const value = { entity: 'event', account_id: 'acc_fixture', event, payload: { subscription: { entity: sub } }, ...mutate }, raw = JSON.stringify(value);
 const r = await oldFetch(base + '/saas/billing/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-event-id': id, 'x-razorpay-signature': createHmac('sha256', values.SAAS_RAZORPAY_TEST_WEBHOOK_SECRET).update(raw).digest('hex') }, body: raw }); return { status: r.status, ...await r.json() };
}
before(async () => {
 database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_billing_test')); process.env.SAAS_FOUNDATION_ENABLED = 'true'; Object.assign(process.env, values);
 const user = await User.create({ name: 'Test billing owner' }); actorId = String(user._id); token = signToken(user); outsiderToken = signToken(await User.create({ name: 'Other owner' }));
 const staff = await User.create({ name: 'Billing staff' }); staffToken = signToken(staff);
 server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
 a = (await api('POST', '/saas/bakeries', { name: 'Billing bakery', slug: 'billing-bakery' })).bakery; b = (await api('POST', '/saas/bakeries', { name: 'Other billing', slug: 'billing-other' })).bakery;
 context = { bakeryId: a._id, userId: actorId, role: 'owner' }; await Membership.create({ bakeryId: a._id, userId: staff._id, role: 'staff' });
 global.fetch = async (url, options = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com/v1/')) return oldFetch(url, options);
  assert.match(options.headers.Authorization, /^Basic /); assert.equal(options.redirect, 'error'); const path = String(url).split('/v1/')[1];
  if (path.startsWith('plans/')) return response({ id: path.slice(6), period: 'monthly', interval: 1, item: { currency: 'INR', amount: expectedAmountPaise } });
  if (path === 'subscriptions' && options.method === 'POST') { createCount++; const input = JSON.parse(options.body); assert.equal(input.customer_notify, false); assert.equal(input.total_count, 12); assert.equal(input.quantity, 1); sub = { id: `sub_fixture${++serial}`, plan_id: input.plan_id, notes: input.notes, quantity: 1, total_count: 12, paid_count: 0, status: 'created', short_url: 'https://rzp.io/rzp/test', current_end: null }; if (failCreate) throw new Error('Response lost after create'); return response(sub); }
  if (/^subscriptions\/sub_/.test(path) && path.endsWith('/cancel')) { if (failCancel) throw new Error('Response lost'); assert.deepEqual(JSON.parse(options.body), { cancel_at_cycle_end: true }); return response(sub); }
  if (/^subscriptions\/sub_/.test(path)) return response(tamper ? { ...sub, notes: { ...sub.notes, saas_bakery: b._id } } : sub);
  if (path.startsWith('invoices?')) return response({ items: invoiceRows }); if (path.startsWith('payments/')) return response(payment);
  throw new Error('Unexpected provider request');
 };
 await billing.ready();
});
beforeEach(async () => { const owner = await User.create({ name: 'Isolated billing owner' }); actorId = String(owner._id); token = signToken(owner); context = { bakeryId: a._id, userId: actorId, role: 'owner' }; await Membership.create([{ bakeryId: a._id, userId: actorId, role: 'owner' }, { bakeryId: b._id, userId: actorId, role: 'owner' }]); await Checkout.deleteMany({}); await Invoice.deleteMany({}); await Event.deleteMany({}); await Change.deleteMany({}); await Audit.deleteMany({}); await Bakery.collection.updateOne({ _id: new mongoose.Types.ObjectId(a._id) }, { $unset: { subscription: '', billingCheckoutId: '' } }); sub = null; invoiceRows = []; payment = null; createCount = 0; failCreate = false; failCancel = false; tamper = false; Object.assign(process.env, values); });
after(async () => { global.fetch = oldFetch; if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('billing rejects live/unconfigured credentials and remains private to the current bakery owner', async () => {
 assert.equal((await api('GET', path(''), undefined, staffToken)).status, 403); assert.equal((await api('GET', path(''), undefined, outsiderToken)).status, 404);
 process.env.SAAS_RAZORPAY_TEST_KEY_ID = 'rzp_live_forbidden'; assert.equal(provider.configured(), false); assert.equal((await api('POST', path('/checkout'), body())).status, 503); assert.equal(createCount, 0);
 delete process.env.SAAS_RAZORPAY_TEST_KEY_ID; assert.equal((await api('GET', path(''))).configured, false);
});
test('reviewed checkout creation is durable and concurrent retries create only one provider subscription', async () => {
 const input = body(); const results = await Promise.all([api('POST', path('/checkout'), input), api('POST', path('/checkout'), input)]); assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(createCount, 1); assert.equal(await Checkout.countDocuments(), 1);
 const replay = await api('POST', path('/checkout'), input); assert.equal(replay.replayed, true); assert.equal(replay.checkout.phase, 'ready'); assert.equal(createCount, 1);
 assert.equal((await api('POST', path('/checkout'), { ...input, planId: 'growth' })).status, 409); assert.equal((await api('POST', path('/checkout'), body())).status, 409);
 const current = await Bakery.findById(a._id); assert.equal(current.subscription.status, 'cancelled'); assert.equal((await api('GET', `/saas/bakeries/${a._id}/subscription`)).access, 'restricted');
});
test('a lost create response is not repeated and recovery must match the original provider notes', async () => {
 const input = body(); failCreate = true; assert.equal((await api('POST', path('/checkout'), input)).status, 503); assert.equal(createCount, 1);
 const replay = await api('POST', path('/checkout'), input); assert.equal(replay.checkout.phase, 'creating'); assert.equal(createCount, 1);
 tamper = true; assert.equal((await api('POST', path('/recover'), { checkoutId: replay.checkout._id, providerSubscriptionId: sub.id, confirmed: true })).status, 409);
 tamper = false; assert.equal((await api('POST', path('/recover'), { checkoutId: replay.checkout._id, providerSubscriptionId: sub.id, confirmed: true })).status, 200);
 assert.equal((await api('POST', path('/checkout'), input)).checkout.phase, 'ready'); assert.equal(createCount, 1);
});
test('verified paid invoices and captured payments govern access, not checkout redirects or event status', async () => {
 const row = await create(); assert.equal((await api('POST', path('/synchronize'), {})).status, 200); assert.equal((await Bakery.findById(a._id)).subscription.status, 'cancelled');
 paid(); assert.equal((await webhook()).status, 200); assert.equal((await Bakery.findById(a._id)).subscription.status, 'cancelled'); assert.equal(await Event.countDocuments({ processedAt: null }), 1);
 assert.equal((await api('POST', path('/synchronize'), {})).status, 200); const bakery = await Bakery.findById(a._id); assert.equal(bakery.subscription.status, 'active'); assert.equal(bakery.subscription.currentPeriodEndsAt.getTime(), invoiceRows[0].billing_end * 1000); assert.equal(await Event.countDocuments({ processedAt: null }), 0);
 const invoices = await api('GET', path('/invoices')); assert.equal(invoices.invoices.length, 1); for (const key of ['bakeryId', 'checkoutId', 'paymentId', 'customer_details']) assert.equal(invoices.invoices[0][key], undefined);
 payment.amount_refunded = 1; assert.equal((await api('POST', path('/synchronize'), {})).status, 200); assert.equal((await Bakery.findById(a._id)).subscription.status, 'cancelled');
 await assert.rejects(() => changeSubscription({ bakeryId: a._id, actorId, apply: true, body: { planId: 'growth', status: 'active', currentPeriodEndsAt: new Date(Date.now() + 86400000).toISOString(), cancelAtPeriodEnd: false, expectedVersion: 1, idempotencyKey: randomUUID(), reason: 'Bypass provider' } }), e => e.statusCode === 409);
 assert.equal(String((await Checkout.findById(row._id)).bakeryId), a._id);
});
test('signed webhook intake deduplicates exact bytes and rejects changed bytes, IDs or accounts', async () => {
 await create(); paid(); assert.equal((await webhook('evt_duplicate')).queued, true); assert.equal((await webhook('evt_duplicate')).replayed, true); assert.equal(await Event.countDocuments(), 1);
 assert.equal((await webhook('evt_duplicate', 'subscription.pending')).status, 409); assert.equal((await webhook('evt_wrong', 'subscription.charged', { account_id: 'acc_other' })).status, 400);
 const raw = JSON.stringify({ entity: 'event', account_id: 'acc_fixture', event: 'subscription.charged' }); const r = await oldFetch(base + '/saas/billing/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-event-id': 'evt_bad', 'x-razorpay-signature': '0'.repeat(64) }, body: raw }); assert.equal(r.status, 400);
 assert.equal((await api('GET', `/saas/bakeries/${b._id}/billing/invoices`)).invoices.length, 0);
});
test('renewal uses invoice paid-through, failed renewal cannot grant an unpaid cycle, cancellation preserves paid access', async () => {
 await create(); paid(); await api('POST', path('/synchronize'), {}); const end = invoiceRows[0].billing_end;
 sub.status = 'pending'; sub.current_end = end + 30 * 86400; await api('POST', path('/synchronize'), {}); let bakery = await Bakery.findById(a._id); assert.equal(bakery.subscription.currentPeriodEndsAt.getTime(), end * 1000); assert.equal(bakery.subscription.status, 'past_due');
 sub.status = 'active'; const checkout = (await api('GET', path(''))).checkout; assert.equal((await api('POST', path('/cancel'), { expectedVersion: checkout.version, confirmed: true })).status, 200);
 bakery = await Bakery.findById(a._id); assert.equal(bakery.subscription.cancelAtPeriodEnd, true); assert.equal(bakery.subscription.currentPeriodEndsAt.getTime(), end * 1000);
 const oldVersion = (await Checkout.findById(checkout._id)).version; assert.equal((await api('POST', path('/cancel'), { expectedVersion: checkout.version, confirmed: true })).status, 200); assert.equal((await Checkout.findById(checkout._id)).version, oldVersion);
});
test('failed reconciliation audit rolls invoices and access back together without losing the queued event', async () => {
 await create(); paid(); await webhook('evt_rollback'); const old = Audit.create; Audit.create = async () => { throw new Error('Synthetic billing audit failure'); };
 try { assert.equal((await api('POST', path('/synchronize'), {})).status, 500); } finally { Audit.create = old; }
 assert.equal((await Bakery.findById(a._id)).subscription.status, 'cancelled'); assert.equal(await Invoice.countDocuments(), 0); assert.equal(await Event.countDocuments({ processedAt: null }), 1);
 assert.equal((await api('POST', path('/synchronize'), {})).status, 200); assert.equal(await Event.countDocuments({ processedAt: null }), 0);
});
test('billing bodies cannot inject prices, periods, customer identity or payment status', async () => {
 assert.equal((await api('POST', path('/checkout'), body({ expectedAmountPaise: 1 }))).status, 409); assert.equal(createCount, 0);
 for (const extra of [{ providerPlanId: 'plan_other' }, { paymentStatus: 'paid' }, { cycles: 1 }, { customerId: actorId }, { confirmed: false }]) assert.equal((await api('POST', path('/checkout'), body(extra))).status, 400);
 assert.equal(await Checkout.countDocuments(), 0); assert.equal(await mongoose.connection.collection('payments').countDocuments(), 0); assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0);
});

test('events arriving during a provider fetch stay pending for the next reconciliation', async () => {
 await create(); paid(); const real = provider.request; let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); let first = true;
 provider.request = async (...args) => { if (String(args[1]).startsWith('invoices?') && first) { first = false; entered(); await gate; } return real(...args); };
 try {
  const syncing = billing.synchronize((await Checkout.findOne({ current: true }))._id, context); await started; assert.equal((await webhook('evt_during_fetch')).status, 200); release(); await syncing; assert.equal(await Event.countDocuments({ processedAt: null }), 1);
 } finally { provider.request = real; }
 await api('POST', path('/synchronize'), {}); assert.equal(await Event.countDocuments({ processedAt: null }), 0);
});
test('an obsolete subscription cannot overwrite a later checkout and its queued notifications can drain', async () => {
 const old = await create(); paid('cancelled'); const end = Math.floor(Date.now() / 1000) - 100; invoiceRows[0].billing_end = end; invoiceRows[0].billing_start = end - 30 * 86400;
 await api('POST', path('/synchronize'), {}); await webhook('evt_old_subscription'); const newer = await create(); assert.notEqual(newer._id, old._id);
 const result = await billing.synchronize(old._id); assert.equal(result.skipped, true); assert.equal(await Event.countDocuments({ processedAt: null }), 0); assert.equal(String((await Bakery.findById(a._id)).billingCheckoutId), newer._id);
});
test('invoice/payment mismatches do not grant access and cancellation failures remain recoverable', async () => {
 await create(); paid(); payment.invoice_id = 'inv_foreign'; assert.equal((await api('POST', path('/synchronize'), {})).status, 200); assert.equal((await Bakery.findById(a._id)).subscription.status, 'cancelled');
 payment.invoice_id = 'inv_cycle'; await api('POST', path('/synchronize'), {}); const current = (await api('GET', path(''))).checkout;
 failCancel = true; assert.equal((await api('POST', path('/cancel'), { expectedVersion: current.version, confirmed: true })).status, 503); const failed = (await api('GET', path(''))).checkout; assert.equal(failed.cancelState, 'uncertain');
 failCancel = false; assert.equal((await api('POST', path('/cancel'), { expectedVersion: failed.version, confirmed: true })).status, 200); assert.equal((await Checkout.findById(current._id)).cancelState, 'confirmed');
});

test('the bounded worker entry point does not make provider calls when its durable inbox is empty', async () => {
 const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path');
 const result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../src/utils/saas-billing-worker.js'), '--uri', database.getUri('saas_billing_test'), '--limit', '1'], { env: process.env, timeout: 15000 });
 assert.deepEqual(JSON.parse(result.stdout), { processed: 0, failed: 0, pending: 0 }); assert.equal(createCount, 0);
});
test('two provider snapshots cannot overwrite one another using the same checkout version', async () => {
 const row = await create(); paid(); const result = await Promise.allSettled([billing.synchronize(row._id, context), billing.synchronize(row._id, context)]);
 assert.equal(result.filter(r => r.status === 'fulfilled').length >= 1, true); assert.equal((await Bakery.findById(a._id)).subscription.status, 'active'); assert.equal(await Invoice.countDocuments(), 1);
 for (const value of result) if (value.status === 'rejected') assert.equal(value.reason.statusCode, 409);
});
