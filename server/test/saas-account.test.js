process.env.NODE_ENV = 'test';
delete process.env.SAAS_LEGACY_WORKSPACE_AUTH;
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Account = require('../src/models/SaasAccount');
const Session = require('../src/models/SaasAccountSession');
const AccountAudit = require('../src/models/SaasAccountAudit');
const User = require('../src/models/User');
const Bakery = require('../src/models/Bakery');
const Membership = require('../src/models/BakeryMembership');
const TenantAudit = require('../src/models/SaasAuditLog');
const Product = require('../src/models/SaasProduct');
const { signToken } = require('../src/services/token.service');
const { matches } = require('../src/saas/customer-password');
const { ownerWrite } = require('../src/saas/owner-write');
const { COOKIE, digest } = require('../src/saas/account-access');
let database, server, base, legacyToken, ip = 0, sequence = 0, alice, bob, cookieA, cookieB;
const password = 'Workspace password!42';
const path = suffix => `/saas/account${suffix}`;
async function api(method, uri, body, identity = 'alice', headers = {}) {
 const cookie = identity === 'alice' ? cookieA : identity === 'bob' ? cookieB : null, account = identity === 'alice' ? alice : identity === 'bob' ? bob : null;
 const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', 'X-Saas-Account': '1', 'X-Saas-Workspace': '1', 'X-Forwarded-For': `10.1.0.${ip || 1}`, ...(cookie ? { Cookie: cookie, 'X-Saas-Account-Id': account.id } : {}), ...(identity === 'legacy' ? { Authorization: `Bearer ${legacyToken}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: response.status, cookie: response.headers.get('set-cookie'), ...await response.json() };
}
async function register(name) { const response = await api('POST', path('/register'), { email: `${name}${++sequence}@example.test`, displayName: name, password, confirmed: true }, 'none'); assert.equal(response.status, 201, JSON.stringify(response)); return { account: response.account, cookie: response.cookie.split(';')[0] }; }
async function bakery(name = 'Workspace A') { const result = await api('POST', '/saas/bakeries', { name, slug: `workspace-${++sequence}` }); assert.equal(result.status, 201, JSON.stringify(result)); return result.bakery; }
before(async () => { database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(database.getUri('saas_account_test')); process.env.SAAS_FOUNDATION_ENABLED = 'true'; legacyToken = signToken(await User.create({ name: 'Legacy admin', role: 'admin' })); const app = require('../src/app'); app.set('trust proxy', 1); server = app.listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
beforeEach(async () => { ip++; const a = await register('Alice'), b = await register('Bob'); alice = a.account; cookieA = a.cookie; bob = b.account; cookieB = b.cookie; });
after(async () => { delete process.env.SAAS_FOUNDATION_ENABLED; delete process.env.SAAS_LEGACY_WORKSPACE_AUTH; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('workspace accounts are separate from global/customer identities and never issue a legacy JWT', async () => {
 assert.equal(await User.countDocuments(), 1); assert.equal(alice.emailVerified, false); assert.equal(alice.passwordHash, undefined);
 assert.equal((await api('GET', '/saas/bakeries', undefined, 'legacy')).status, 401); assert.equal((await api('GET', '/auth/me')).status, 401); assert.equal((await api('GET', '/admin/products')).status, 401);
 const me = await api('GET', path('/me')); assert.equal(me.account.id, alice.id); assert.equal(me.token, undefined); assert.equal(me.account.role, undefined);
 const raw = cookieA.split('=')[1], stored = await Session.findOne({ accountId: alice.id }).select('+tokenHash'); assert.equal(stored.tokenHash, digest(raw)); assert.notEqual(stored.tokenHash, raw);
 const owned = await bakery(); const member = await Membership.findOne({ bakeryId: owned._id, userId: alice.id }); assert.equal(member.accountType, 'saas'); assert.equal(member.role, 'owner'); assert.equal((await Bakery.findById(owned._id)).createdByType, 'saas');
 assert.equal((await api('GET', `/saas/bakeries/${owned._id}/products`, undefined, 'bob')).status, 404);
 const login = await api('POST', path('/login'), { email: alice.email, password }, 'none'); assert.equal(login.status, 200); assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /SameSite=Strict/); assert.match(login.cookie, /Path=\/api\/saas/);
});
test('account/role selectors and cross-tab identity swaps cannot change authorization', async () => {
 assert.equal((await api('POST', path('/register'), { email: 'injected@example.test', displayName: 'Injected', password, confirmed: true, role: 'admin' }, 'none')).status, 400);
 assert.equal((await api('GET', '/saas/bakeries', undefined, 'alice', { 'X-Saas-Account-Id': bob.id })).status, 409);
 assert.equal((await api('POST', path('/logout'), {}, 'alice', { 'X-Saas-Account-Id': bob.id })).status, 409); assert.equal((await api('GET', path('/me'))).status, 200);
 assert.equal((await api('POST', path('/login'), { email: alice.email, password }, 'none', { 'X-Saas-Account': '' })).status, 403);
 assert.equal((await api('POST', path('/login'), { email: alice.email, password }, 'none', { Origin: 'https://untrusted.example' })).status, 403);
 assert.equal((await api('POST', '/saas/bakeries', { name: 'Bad intent', slug: 'bad-intent' }, 'alice', { 'X-Saas-Workspace': '' })).status, 403);
});
test('staff invitations work with typed workspace accounts and never grant owner or legacy access', async () => {
 const owned = await bakery(); const invitation = await api('POST', `/saas/bakeries/${owned._id}/invitations`, { expiresInMinutes: 30 }); assert.equal(invitation.status, 201);
 assert.equal((await api('POST', '/saas/invitations/inspect', { token: invitation.token }, 'bob')).role, 'staff'); assert.equal((await api('POST', '/saas/invitations/accept', { token: invitation.token }, 'bob')).status, 200);
 const member = await Membership.findOne({ bakeryId: owned._id, userId: bob.id }); assert.equal(member.accountType, 'saas');
 assert.equal((await api('POST', `/saas/bakeries/${owned._id}/products`, { name: 'Forbidden', slug: 'forbidden', category: 'Cake', pricePaise: 100 }, 'bob')).status, 403);
 const members = await api('GET', `/saas/bakeries/${owned._id}/members`); assert.ok(members.members.some(row => row.name === 'Bob' && row.accountActive));
 assert.equal((await api('POST', `/saas/bakeries/${owned._id}/members/${member._id}/revoke`, { expectedVersion: 1, confirmed: true })).status, 200);
 assert.equal((await api('GET', `/saas/bakeries/${owned._id}/products`, undefined, 'bob')).status, 404); assert.equal((await api('GET', path('/me'), undefined, 'bob')).status, 200);
});
test('creation is capped across concurrent requests, including suspended workspaces', async () => {
 for (let i = 0; i < 4; i++) await bakery();
 const results = await Promise.all([api('POST', '/saas/bakeries', { name: 'Fifth', slug: `quota-${++sequence}` }), api('POST', '/saas/bakeries', { name: 'Sixth', slug: `quota-${++sequence}` })]); assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
 assert.equal(await Bakery.countDocuments({ createdBy: alice.id }), 5); await Bakery.updateMany({ createdBy: alice.id }, { $set: { status: 'suspended' } }); assert.equal((await api('POST', '/saas/bakeries', { name: 'Bypass', slug: `quota-${++sequence}` })).status, 409);
});
test('expired sessions and invalid cookies cannot fall back to a legacy admin token', async () => {
 const login = await Session.findOne({ accountId: alice.id }); await Session.collection.updateOne({ _id: login._id }, { $set: { expiresAt: new Date(0) } });
 process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
 try { assert.equal((await api('GET', '/saas/bakeries', undefined, 'alice', { Authorization: `Bearer ${legacyToken}` })).status, 401); assert.equal((await api('GET', '/saas/bakeries', undefined, 'legacy', { Cookie: `${COOKIE}=invalid` })).status, 401); } finally { delete process.env.SAAS_LEGACY_WORKSPACE_AUTH; }
});
test('password changes revoke workspace sessions across bakeries, with audit rollback and no customer/global mutation', async () => {
 const owned = await bakery(); const payload = { currentPassword: password, newPassword: 'New workspace password!43', confirmed: true }; const original = AccountAudit.create;
 AccountAudit.create = async () => { throw new Error('Synthetic workspace audit failure'); };
 try { assert.equal((await api('POST', path('/password/change'), payload)).status, 500); } finally { AccountAudit.create = original; }
 assert.equal((await api('GET', path('/me'))).status, 200); assert.equal((await api('POST', path('/password/change'), payload)).status, 200);
 assert.equal((await api('GET', `/saas/bakeries/${owned._id}/products`)).status, 401); assert.equal((await api('GET', path('/me'), undefined, 'bob')).status, 200);
 const account = await Account.findById(alice.id).select('+passwordHash'); assert.equal(await matches(payload.newPassword, account.passwordHash), true); assert.equal(account.sessionVersion, 2);
 assert.equal(await User.countDocuments(), 1); assert.equal(await mongoose.connection.collection('saas_customers').countDocuments(), 0);
});
test('fresh transaction authorization rejects a session revoked after middleware lookup', async () => {
 const owned = await bakery(), login = await Session.findOne({ accountId: alice.id }); const context = { identityType: 'saas', bakeryId: owned._id, userId: alice.id, role: 'owner', sessionId: String(login._id), sessionVersion: 1 };
 await Session.deleteOne({ _id: login._id }); await assert.rejects(() => ownerWrite(context, () => { throw new Error('Must not run'); }), e => e.statusCode === 401);
 const count = await Bakery.countDocuments(); const original = TenantAudit.create; TenantAudit.create = async () => { throw new Error('Synthetic bakery audit failure'); };
 try { assert.equal((await api('POST', '/saas/bakeries', { name: 'Rollback', slug: `rollback-${++sequence}` }, 'bob')).status, 500); } finally { TenantAudit.create = original; }
 assert.equal(await Bakery.countDocuments(), count);
});
test('identical object IDs in legacy and workspace realms do not reuse a legacy membership', async () => {
 const legacy = await User.create({ _id: new mongoose.Types.ObjectId(alice.id), name: 'Different legacy identity' });
 const [owned] = await Bakery.create([{ name: 'Legacy realm', slug: `realm-${++sequence}`, createdBy: legacy._id }]); await Membership.create({ bakeryId: owned._id, userId: legacy._id, role: 'owner', accountType: 'legacy' });
 assert.equal((await api('GET', `/saas/bakeries/${owned._id}/context`)).status, 404);
});
test('logout is scoped/idempotent and retains another workspace account session', async () => {
 assert.equal((await api('POST', path('/logout'), {})).status, 200); assert.equal((await api('POST', path('/logout'), {})).status, 200); assert.equal((await api('GET', path('/me'))).status, 401); assert.equal((await api('GET', path('/me'), undefined, 'bob')).status, 200);
});
