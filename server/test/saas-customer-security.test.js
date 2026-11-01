process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Customer = require('../src/models/SaasCustomer');
const Session = require('../src/models/SaasCustomerSession');
const Action = require('../src/models/SaasCustomerAction');
const Preview = require('../src/models/SaasCustomerMailPreview');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
const { hashPassword, matches } = require('../src/saas/customer-password');
const { digest, cookieName } = require('../src/saas/customer-access');
const { decryptToken } = require('../src/saas/customer-mail-preview');
let database, server, base, ownerToken, a, b, alice, bob, foreign, cookieA, cookieBob, cookieB, ip = 0, originalHash;
const password = 'Initial local password!42', nextPassword = 'A new local password!43';
const oldFlag = process.env.SAAS_FOUNDATION_ENABLED, oldKey = process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY, previewKey = randomBytes(32).toString('hex');
const route = (bakery, suffix) => `/saas/storefront/${bakery.slug}/customer${suffix}`;
async function api(method, path, body, identity = 'alice', headers = {}) {
 const cookie = identity === 'alice' ? cookieA : identity === 'bob' ? cookieBob : identity === 'foreign' ? cookieB : null;
 const customer = identity === 'alice' ? alice : identity === 'bob' ? bob : identity === 'foreign' ? foreign : null;
 const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Customer': '1', 'X-Forwarded-For': `10.0.0.${ip || 1}`, ...(cookie ? { Cookie: cookie, 'X-Saas-Customer-Id': String(customer._id) } : {}), ...(identity === 'owner' ? { Authorization: `Bearer ${ownerToken}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function sessionFor(customer) { const token = randomBytes(32).toString('hex'); await Session.create({ bakeryId: customer.bakeryId, customerId: customer._id, tokenHash: digest(token), sessionVersion: customer.sessionVersion, expiresAt: new Date(Date.now() + 3600000) }); return `${cookieName(customer.bakeryId)}=${token}`; }
const requestReset = (email = 'alice@example.test') => api('POST', route(a, '/password-reset/request'), { email }, 'none');
async function preview(purpose = 'password_reset', customer = alice) { return Preview.findOne({ bakeryId: customer.bakeryId, customerId: customer._id, purpose }).sort({ createdAt: -1, _id: -1 }).select('+ciphertext +iv +tag').lean(); }
const confirmReset = (token, newPassword = nextPassword) => api('POST', route(a, '/password-reset/confirm'), { token, newPassword }, 'none');
before(async () => {
 database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_customer_security_test'));
 process.env.SAAS_FOUNDATION_ENABLED = 'true'; process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY = previewKey;
 ownerToken = signToken(await User.create({ name: 'Security fixture owner' })); const app = require('../src/app'); app.set('trust proxy', 1); server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
 a = (await api('POST', '/saas/bakeries', { name: 'Security A', slug: 'security-a' }, 'owner')).bakery;
 b = (await api('POST', '/saas/bakeries', { name: 'Security B', slug: 'security-b' }, 'owner')).bakery;
 for (const bakery of [a, b]) await api('PATCH', `/saas/bakeries/${bakery._id}/storefront-settings`, { expectedVersion: 0, published: true, acceptCustomerOrders: true }, 'owner');
 originalHash = await hashPassword(password);
 alice = await Customer.create({ bakeryId: a._id, email: 'alice@example.test', displayName: 'Alice', passwordHash: originalHash });
 bob = await Customer.create({ bakeryId: a._id, email: 'bob@example.test', displayName: 'Bob', passwordHash: originalHash });
 foreign = await Customer.create({ bakeryId: b._id, email: 'alice@example.test', displayName: 'Other Alice', passwordHash: originalHash });
 await Promise.all([Action.init(), Preview.init(), Audit.init()]);
});
beforeEach(async () => {
 ip++; await Action.deleteMany({}); await Preview.deleteMany({}); await Session.deleteMany({}); await Audit.deleteMany({});
 await Customer.updateMany({}, { $set: { passwordHash: originalHash, sessionVersion: 1, emailVerified: false, emailPreviewConfirmedAt: null, active: true } });
 for (const customer of [alice, bob, foreign]) customer.sessionVersion = 1;
 cookieA = await sessionFor(alice); cookieBob = await sessionFor(bob); cookieB = await sessionFor(foreign);
});
after(async () => { if (oldFlag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = oldFlag; if (oldKey === undefined) delete process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY; else process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY = oldKey; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('reset requests are generic, throttled per account and expose no token or plaintext preview', async () => {
 const known = await requestReset(), unknown = await requestReset('unknown@example.test'); assert.deepEqual(known, unknown); assert.equal(known.status, 200); assert.equal(known.cookie, null);
 await requestReset(); assert.equal(await Action.countDocuments(), 1); assert.equal(await Preview.countDocuments(), 1);
 const row = await preview(), token = decryptToken(row); assert.match(token, /^[a-f0-9]{64}$/); assert.equal(row.ciphertext.includes(token), false);
 assert.equal((await Action.findOne().select('+tokenHash')).tokenHash, digest(token)); assert.equal((await Action.findOne().lean()).tokenHash, undefined);
 const hidden = await Preview.findOne().lean(); for (const field of ['ciphertext', 'iv', 'tag']) assert.equal(hidden[field], undefined);
 assert.equal(JSON.stringify(known).includes(token), false); assert.equal((await api('GET', route(a, '/mail-previews'), undefined, 'owner')).status, 401);
});
test('verification preview is purpose/bakery scoped, one use, and never claims real email ownership', async () => {
 assert.equal((await api('POST', route(a, '/email-verification/request'), {}, 'alice')).status, 200); const token = decryptToken(await preview('email_verify'));
 assert.equal((await confirmReset(token)).status, 400);
 assert.equal((await api('POST', route(b, '/email-verification/confirm'), { token }, 'none')).status, 400);
 assert.equal((await api('POST', route(a, '/email-verification/confirm'), { token }, 'bob')).status, 200);
 const profile = (await api('GET', route(a, '/me'), undefined, 'alice')).customer; assert.equal(profile.emailVerified, false); assert.ok(profile.emailPreviewConfirmedAt);
 assert.equal((await api('GET', route(a, '/me'), undefined, 'bob')).customer.emailPreviewConfirmedAt, null);
 assert.equal((await api('POST', route(a, '/email-verification/confirm'), { token }, 'none')).status, 400); assert.equal(await Preview.countDocuments(), 0);
});
test('password reset is single-use under concurrency and revokes only the target bakery account sessions', async () => {
 await sessionFor(alice); await requestReset(); const token = decryptToken(await preview());
 const results = await Promise.all([confirmReset(token), confirmReset(token)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); assert.equal(results[0].cookie, null);
 const saved = await Customer.findById(alice._id).select('+passwordHash'); assert.equal(saved.sessionVersion, 2); assert.equal(await matches(nextPassword, saved.passwordHash), true);
 assert.equal(await Session.countDocuments({ customerId: alice._id }), 0); assert.equal(await Session.countDocuments({ customerId: bob._id }), 1); assert.equal(await Session.countDocuments({ customerId: foreign._id }), 1);
 assert.equal((await api('GET', route(a, '/me'), undefined, 'alice')).status, 401); assert.equal((await api('GET', route(b, '/me'), undefined, 'foreign')).status, 200);
 assert.equal((await api('POST', route(a, '/login'), { email: 'alice@example.test', password }, 'none')).status, 401);
 assert.equal((await api('POST', route(a, '/login'), { email: 'alice@example.test', password: nextPassword }, 'none')).status, 200);
 assert.equal(await Audit.countDocuments({ action: 'customer.resetPassword' }), 1); assert.equal(await Preview.countDocuments(), 0);
});
test('expiry, replaced tokens and credential version mismatch reject before credential mutation', async () => {
 await requestReset(); const old = await preview(), token = decryptToken(old);
 await Action.collection.updateOne({ _id: old.actionId }, { $set: { createdAt: new Date(Date.now() - 61000) } }); await requestReset(); const newer = await preview();
 assert.notEqual(newer.actionId.toString(), old.actionId.toString()); assert.equal((await confirmReset(token)).status, 400);
 await Action.collection.updateOne({ _id: newer.actionId }, { $set: { expiresAt: new Date(0) } }); assert.equal((await confirmReset(decryptToken(newer))).status, 400);
 assert.equal((await Customer.findById(alice._id).select('+passwordHash')).passwordHash, originalHash);
});
test('a reset audit failure rolls password, consumed tokens, previews and session revocation back', async () => {
 await requestReset(); const row = await preview(), token = decryptToken(row), original = Audit.create; Audit.create = async () => { throw new Error('Synthetic security audit failure'); };
 try { assert.equal((await confirmReset(token)).status, 500); } finally { Audit.create = original; }
 assert.equal((await Customer.findById(alice._id).select('+passwordHash')).passwordHash, originalHash); assert.equal((await Action.findById(row.actionId)).consumedAt, null);
 assert.equal(await Session.countDocuments({ customerId: alice._id }), 1); assert.equal(await Preview.countDocuments(), 1); assert.equal((await confirmReset(token)).status, 200);
});
test('changing a password requires current proof, exact session identity and explicit confirmation', async () => {
 const body = { currentPassword: password, newPassword: nextPassword, confirmed: true }, path = route(a, '/password/change');
 assert.equal((await api('POST', path, { ...body, currentPassword: 'An incorrect password!42' })).status, 400);
 assert.equal((await api('POST', path, { ...body, confirmed: false })).status, 400); assert.equal((await api('POST', path, { ...body, newPassword: password })).status, 400);
 assert.equal((await api('POST', path, body, 'alice', { 'X-Saas-Customer-Id': String(bob._id) })).status, 409);
 assert.equal((await api('POST', path, body, 'owner')).status, 401); assert.equal((await api('POST', path, body)).status, 200);
 assert.equal(await Session.countDocuments({ customerId: alice._id }), 0); assert.equal(await Session.countDocuments({ customerId: foreign._id }), 1);
});
test('reset and signed-in password change serialize so only one credential update succeeds', async () => {
 await requestReset(); const token = decryptToken(await preview()), alternative = 'Another new password!44';
 const results = await Promise.all([confirmReset(token), api('POST', route(a, '/password/change'), { currentPassword: password, newPassword: alternative, confirmed: true })]);
 assert.equal(results.filter(r => r.status === 200).length, 1);
 const saved = await Customer.findById(alice._id).select('+passwordHash'); assert.equal(saved.sessionVersion, 2); assert.equal((await matches(nextPassword, saved.passwordHash)) || (await matches(alternative, saved.passwordHash)), true);
 assert.equal(await Audit.countDocuments({ action: { $in: ['customer.resetPassword', 'customer.changePassword'] } }), 1);
});
test('tokens require intent, reject extra fields and never accept raw customer or tenant selectors', async () => {
 await requestReset(); const token = decryptToken(await preview());
 assert.equal((await api('POST', route(a, '/password-reset/confirm'), { token, newPassword: nextPassword }, 'none', { 'X-Saas-Customer': '' })).status, 403);
 assert.equal((await api('POST', route(a, '/password-reset/confirm'), { token, newPassword: nextPassword, customerId: bob._id }, 'none')).status, 400);
 assert.equal((await api('POST', route(a, '/password-reset/confirm'), { token, newPassword: nextPassword }, 'none', { Origin: 'https://untrusted.example' })).status, 403);
 assert.equal((await api('POST', route(b, '/password-reset/confirm'), { token, newPassword: nextPassword }, 'none')).status, 400);
 assert.equal((await confirmReset(token, 'short')).status, 400);
});
test('mail preview requires an explicit key, binds ciphertext to its context, and the operator command is read-only', async () => {
 const key = process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY; delete process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY;
 try { assert.equal((await requestReset()).status, 503); assert.equal((await requestReset('missing@example.test')).status, 503); } finally { process.env.SAAS_LOCAL_MAIL_PREVIEW_KEY = key; }
 await requestReset(); const row = await preview(); assert.throws(() => decryptToken({ ...row, customerId: bob._id }));
 const { execFile } = require('node:child_process'), { promisify } = require('node:util'), path = require('node:path');
 const { stdout } = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../src/utils/saas-customer-mail-preview.js'), '--uri', database.getUri('saas_customer_security_test'), '--bakery-id', a._id, '--email', alice.email, '--purpose', 'password_reset'], { env: process.env, timeout: 15000 });
 const result = JSON.parse(stdout); assert.equal(result.token, decryptToken(row)); assert.equal(result.deliveryMode, 'local-preview'); assert.equal((await Action.findById(row.actionId)).consumedAt, null);
 assert.equal(await mongoose.connection.collection('orders').countDocuments(), 0); assert.equal(await User.countDocuments(), 1);
});
test('anonymous mail requests are rate limited across bakery slugs without disclosing account existence', async () => {
 for (let i = 0; i < 5; i++) assert.equal((await requestReset(`missing${i}@example.test`)).status, 200);
 assert.equal((await api('POST', route(b, '/password-reset/request'), { email: 'missing@example.test' }, 'none')).status, 429); assert.equal(await Preview.countDocuments(), 0);
});

test('recovery and existing-customer login remain available when a bakery hides its menu', async () => {
 assert.equal((await api('PATCH', `/saas/bakeries/${a._id}/storefront-settings`, { expectedVersion: 1, published: false, acceptCustomerOrders: false }, 'owner')).status, 200);
 try {
  await requestReset(); const token = decryptToken(await preview()); assert.equal((await confirmReset(token)).status, 200);
  assert.equal((await api('POST', route(a, '/login'), { email: alice.email, password: nextPassword }, 'none')).status, 200);
  assert.equal((await api('POST', route(a, '/register'), { email: 'not-registered@example.test', displayName: 'New', password }, 'none')).status, 409);
 } finally { await api('PATCH', `/saas/bakeries/${a._id}/storefront-settings`, { expectedVersion: 2, published: true, acceptCustomerOrders: true }, 'owner'); }
});
