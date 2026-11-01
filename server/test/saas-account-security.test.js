process.env.NODE_ENV = 'test';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../src/models/SaasAccount');
const Session = require('../src/models/SaasAccountSession');
const Action = require('../src/models/SaasAccountAction');
const Preview = require('../src/models/SaasAccountMailPreview');
const Audit = require('../src/models/SaasAccountAudit');
const Customer = require('../src/models/SaasCustomer');
const User = require('../src/models/User');
const { hashPassword, matches } = require('../src/saas/customer-password');
const { digest, COOKIE } = require('../src/saas/account-access');
const { decryptToken } = require('../src/saas/account-mail-preview');
let database, server, base, alice, bob, cookieA, cookieB, initialHash, ip = 0;
const password = 'Initial owner password!42', nextPassword = 'New owner password!43';
const key = randomBytes(32).toString('hex');
async function api(uri, body, identity = 'none', headers = {}, method = 'POST') {
 const account = identity === 'alice' ? alice : identity === 'bob' ? bob : null, cookie = identity === 'alice' ? cookieA : cookieB;
 const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Account': '1', 'X-Forwarded-For': `10.2.0.${ip}`, ...(account ? { Cookie: cookie, 'X-Saas-Account-Id': String(account._id) } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function sessionFor(account) { const token = randomBytes(32).toString('hex'); await Session.create({ accountId: account._id, tokenHash: digest(token), sessionVersion: account.sessionVersion, expiresAt: new Date(Date.now() + 3600000) }); return `${COOKIE}=${token}`; }
const request = (email = 'owner@example.test') => api('/password-reset/request', { email });
async function proof(purpose = 'password_reset', account = alice) { return decryptToken(await Preview.findOne({ accountId: account._id, purpose }).select('+ciphertext +iv +tag').lean()); }
const confirm = (token, newPassword = nextPassword, identity = 'none') => api('/password-reset/confirm', { token, newPassword, confirmed: true }, identity);
before(async () => {
 database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_account_security_test'));
 process.env.SAAS_FOUNDATION_ENABLED = 'true'; process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY = key;
 initialHash = await hashPassword(password); alice = await Account.create({ email: 'owner@example.test', displayName: 'Alice', passwordHash: initialHash }); bob = await Account.create({ email: 'bob@example.test', displayName: 'Bob', passwordHash: initialHash });
 await Promise.all([Action.init(), Preview.init(), Audit.init(), Session.init()]); const app = require('../src/app'); app.set('trust proxy', 1); server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api/saas/account`;
});
beforeEach(async () => { ip++; await Action.deleteMany({}); await Preview.deleteMany({}); await Session.deleteMany({}); await Audit.deleteMany({}); await Account.updateMany({}, { $set: { passwordHash: initialHash, sessionVersion: 1, active: true, emailVerified: false, emailPreviewConfirmedAt: null } }); alice.sessionVersion = bob.sessionVersion = 1; cookieA = await sessionFor(alice); cookieB = await sessionFor(bob); process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY = key; });
after(async () => { delete process.env.SAAS_FOUNDATION_ENABLED; delete process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY; if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); if (database) await database.stop(); });
test('owner reset requests are generic, cooldown bounded and previews reveal no plaintext through HTTP', async () => {
 const known = await request(), unknown = await request('missing@example.test'); assert.deepEqual(known, unknown); assert.equal(known.status, 200); assert.equal(known.cookie, null); await request(); assert.equal(await Action.countDocuments(), 1);
 const token = await proof(), row = await Action.findOne({ accountId: alice._id }).select('+tokenHash'); assert.equal(row.tokenHash, digest(token)); assert.notEqual(row.tokenHash, token); assert.equal((await Preview.findOne()).ciphertext, undefined);
 const preview = await Preview.findOne().select('+ciphertext +iv +tag').lean(); assert.throws(() => decryptToken({ ...preview, accountId: bob._id }));
 delete process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY; const unavailable = await request(), unknownUnavailable = await request('missing@example.test'); assert.equal(unavailable.status, 503); assert.equal(unknownUnavailable.status, 503); assert.equal(unavailable.message, unknownUnavailable.message);
});
test('a reset revokes every target workspace session and consumes all account proofs without changing another cookie or identity realm', async () => {
 await sessionFor(alice); const foreignUser = await User.create({ name: 'Same email legacy', email: alice.email }); const customer = await Customer.create({ bakeryId: new mongoose.Types.ObjectId(), displayName: 'Same email customer', email: alice.email, passwordHash: initialHash });
 await request(); const token = await proof(); delete process.env.SAAS_LOCAL_OWNER_MAIL_PREVIEW_KEY; const result = await confirm(token, nextPassword, 'bob'); assert.equal(result.status, 200); assert.equal(result.cookie, null); assert.equal(await Session.countDocuments({ accountId: alice._id }), 0); assert.equal(await Session.countDocuments({ accountId: bob._id }), 1); assert.equal((await api('/me', undefined, 'bob', {}, 'GET')).status, 200); assert.equal((await api('/me', undefined, 'alice', {}, 'GET')).status, 401);
 assert.equal(await Preview.countDocuments(), 0); assert.equal((await confirm(token)).status, 400); assert.equal(await matches(nextPassword, (await Account.findById(alice._id).select('+passwordHash')).passwordHash), true); assert.equal((await Account.findById(alice._id)).emailVerified, false);
 assert.ok(await User.findById(foreignUser._id)); assert.equal((await Customer.findById(customer._id).select('+passwordHash')).passwordHash, initialHash);
});
test('preview verification cannot mark real mailbox ownership, reset passwords or sign anyone in', async () => {
 assert.equal((await api('/email-verification/request', {}, 'none')).status, 401); assert.equal((await api('/email-verification/request', {}, 'alice')).status, 200); const token = await proof('email_verify'); assert.equal((await confirm(token)).status, 400);
 const result = await api('/email-verification/confirm', { token, confirmed: true }, 'bob'); assert.equal(result.status, 200); assert.equal(result.cookie, null); const account = await Account.findById(alice._id); assert.equal(account.emailVerified, false); assert.ok(account.emailPreviewConfirmedAt); assert.equal(account.sessionVersion, 1); assert.equal(await Session.countDocuments({ accountId: alice._id }), 1); assert.equal((await api('/email-verification/confirm', { token, confirmed: true })).status, 400);
});
test('purpose, expiry, active-state, version and caller selectors fail closed', async () => {
 await request(); const token = await proof(); assert.equal((await api('/email-verification/confirm', { token, confirmed: true })).status, 400); assert.equal((await api('/password-reset/confirm', { token, newPassword: nextPassword, confirmed: true, accountId: bob._id })).status, 400); assert.equal((await api('/password-reset/confirm', { token, newPassword: nextPassword })).status, 400);
 await Account.updateOne({ _id: alice._id }, { $set: { active: false } }); assert.equal((await confirm(token)).status, 400); await Account.updateOne({ _id: alice._id }, { $set: { active: true, sessionVersion: 2 } }); assert.equal((await confirm(token)).status, 400); await Account.updateOne({ _id: alice._id }, { $set: { sessionVersion: 1 } }); await Action.collection.updateOne({ accountId: alice._id }, { $set: { expiresAt: new Date(0) } }); assert.equal((await confirm(token)).status, 400);
});
test('concurrent reset confirmations succeed exactly once and audited failures roll back credentials and sessions', async () => {
 await request(); const token = await proof(), original = Audit.create; Audit.create = async () => { throw new Error('Synthetic account audit failure'); };
 try { assert.equal((await confirm(token)).status, 500); } finally { Audit.create = original; }
 assert.equal((await Account.findById(alice._id)).sessionVersion, 1); assert.equal(await Session.countDocuments({ accountId: alice._id }), 1); assert.equal((await Action.findOne()).consumedAt, null); assert.equal(await Preview.countDocuments(), 1);
 const results = await Promise.all([confirm(token), confirm(token)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); assert.equal(await Audit.countDocuments({ action: 'password.reset' }), 1);
});
test('replacement and password-change invalidation prevent reusing old reset proofs', async () => {
 await request(); const old = await proof(); await Action.collection.updateOne({ accountId: alice._id }, { $set: { createdAt: new Date(Date.now() - 61000) } }); await request(); const token = await proof(); assert.notEqual(token, old); assert.equal((await confirm(old)).status, 400);
 const changed = await api('/password/change', { currentPassword: password, newPassword: nextPassword, confirmed: true }, 'alice'); assert.equal(changed.status, 200); assert.equal((await confirm(token)).status, 400); assert.equal(await Preview.countDocuments(), 0);
});
test('mail endpoints require intent, check account swaps, and enforce a shared IP request limit', async () => {
 assert.equal((await api('/password-reset/request', { email: alice.email }, 'none', { 'X-Saas-Account': '' })).status, 403); assert.equal((await api('/password-reset/request', { email: alice.email }, 'none', { Origin: 'https://evil.test' })).status, 403); assert.equal((await api('/email-verification/request', {}, 'alice', { 'X-Saas-Account-Id': String(bob._id) })).status, 409);
 for (let i = 0; i < 5; i++) assert.equal((await request('missing@example.test')).status, 200); assert.equal((await request()).status, 429);
});
test('owner operator preview reads only an explicitly selected local proof and rejects unsafe databases', async () => {
 await request(); const { execFileSync } = require('node:child_process');
 const output = JSON.parse(execFileSync(process.execPath, [require.resolve('../src/utils/saas-account-mail-preview'), '--uri', database.getUri('saas_account_security_test'), '--email', alice.email, '--purpose', 'password_reset'], { env: process.env, encoding: 'utf8' }));
 assert.equal(output.token, await proof()); assert.equal(output.email, alice.email); assert.equal((await Action.findOne()).consumedAt, null); assert.equal(await Preview.countDocuments(), 1);
 const { argumentsOf } = require('../src/utils/saas-account-mail-preview'); const args = ['--uri', 'mongodb://127.0.0.1:27017/saas_example', '--email', alice.email, '--purpose', 'password_reset']; assert.ok(argumentsOf(args));
 for (const uri of ['mongodb+srv://example.com/saas_example', 'mongodb://127.0.0.1/prod', 'mongodb://user:pass@127.0.0.1/saas_example', 'mongodb://127.0.0.1/saas_example?directConnection=false']) assert.throws(() => argumentsOf(['--uri', uri, ...args.slice(2)])); assert.throws(() => argumentsOf([...args, '--bakery-id', String(alice._id)]));
});
