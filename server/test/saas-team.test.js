process.env.NODE_ENV = 'test';
process.env.SAAS_LEGACY_WORKSPACE_AUTH = 'true';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/User');
const Membership = require('../src/models/BakeryMembership');
const Invitation = require('../src/models/SaasInvitation');
const Audit = require('../src/models/SaasAuditLog');
const { signToken } = require('../src/services/token.service');
let database, server, base, owner, other, person, token, otherToken, personToken, a, b, invite, secondInvite, personMember, originalUser;
const flag = process.env.SAAS_FOUNDATION_ENABLED;
const path = (bakery, suffix) => `/saas/bakeries/${bakery._id}/${suffix}`;
async function api(method, uri, body, credentials = token) {
  const response = await fetch(base + uri, { method, headers: { 'Content-Type': 'application/json', ...(credentials ? { Authorization: `Bearer ${credentials}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
}
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket'] } });
  await mongoose.connect(database.getUri('saas_team_test'));
  [owner, other, person] = await User.create([{ name: 'Team owner A' }, { name: 'Team owner B' }, { name: 'Invited staff' }]);
  token = signToken(owner); otherToken = signToken(other); personToken = signToken(person);
  originalUser = await User.findById(person._id).lean();
  process.env.SAAS_FOUNDATION_ENABLED = 'true'; server = require('../src/app').listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  a = (await api('POST', '/saas/bakeries', { name: 'Team A', slug: 'team-a' })).bakery;
  b = (await api('POST', '/saas/bakeries', { name: 'Team B', slug: 'team-b' }, otherToken)).bakery;
});
after(async () => {
  if (flag === undefined) delete process.env.SAAS_FOUNDATION_ENABLED; else process.env.SAAS_FOUNDATION_ENABLED = flag;
  if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop();
});

test('only owners create staff invitations and only hashes are persisted or listed', async () => {
  assert.equal((await api('POST', path(a, 'invitations'), {}, personToken)).status, 404);
  assert.equal((await api('POST', path(a, 'invitations'), {}, otherToken)).status, 404);
  for (const data of [{ role: 'owner' }, { bakeryId: b._id }, { expiresInMinutes: 0 }, { expiresInMinutes: 1441 }]) assert.equal((await api('POST', path(a, 'invitations'), data)).status, 400);
  const response = await api('POST', path(a, 'invitations'), { expiresInMinutes: 30 });
  assert.equal(response.status, 201); invite = response;
  assert.match(invite.token, /^[a-f0-9]{64}$/);
  const stored = await Invitation.findById(invite.invitation._id).select('+tokenHash').lean();
  assert.equal(stored.tokenHash, createHash('sha256').update(invite.token).digest('hex'));
  assert.equal(JSON.stringify(stored).includes(invite.token), false);
  const list = await api('GET', path(a, 'invitations'));
  assert.equal(list.invitations.length, 1); assert.equal(list.invitations[0].tokenHash, undefined); assert.equal(list.invitations[0].token, undefined);
  const memberList = await api('GET', path(a, 'members'));
  assert.equal(memberList.members[0].role, 'owner'); assert.equal(memberList.members[0].email, undefined); assert.equal(memberList.members[0].phone, undefined);
});

test('a valid invite can be inspected and accepted without granting global admin or another bakery access', async () => {
  const inspected = await api('POST', '/saas/invitations/inspect', { token: invite.token }, personToken);
  assert.equal(inspected.status, 200); assert.equal(inspected.bakery._id, a._id); assert.equal(inspected.role, 'staff'); assert.equal(inspected.alreadyMember, false);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: invite.token }, null)).status, 401);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: invite.token, role: 'owner' }, personToken)).status, 400);
  const ownerInspect = await api('POST', '/saas/invitations/accept', { token: invite.token });
  assert.equal(ownerInspect.status, 200); assert.equal(ownerInspect.alreadyMember, true);
  assert.equal((await Invitation.findById(invite.invitation._id)).acceptedBy, null);
  const accepted = await api('POST', '/saas/invitations/accept', { token: invite.token.toUpperCase() }, personToken);
  assert.equal(accepted.status, 200, JSON.stringify(accepted)); assert.equal(accepted.role, 'staff');
  assert.equal((await api('GET', path(a, 'products'), undefined, personToken)).status, 200);
  assert.equal((await api('GET', path(a, 'recipes'), undefined, personToken)).status, 403);
  assert.equal((await api('GET', path(a, 'members'), undefined, personToken)).status, 403);
  assert.equal((await api('GET', path(b, 'products'), undefined, personToken)).status, 404);
  assert.equal((await api('GET', '/admin/products', undefined, personToken)).status, 403);
  assert.deepEqual(await User.findById(person._id).lean(), originalUser);
  const repeat = await api('POST', '/saas/invitations/accept', { token: invite.token }, personToken);
  assert.equal(repeat.status, 200); assert.equal(repeat.alreadyMember, true);
  personMember = await Membership.findOne({ bakeryId: a._id, userId: person._id }).lean();
  assert.equal(personMember.role, 'staff'); assert.equal(personMember.version, 1);
});

test('revoking staff affects only that bakery and a consumed code cannot restore revoked access', async () => {
  secondInvite = await api('POST', path(b, 'invitations'), {}, otherToken);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: secondInvite.token }, personToken)).status, 200);
  const uri = path(a, `members/${personMember._id}/revoke`);
  assert.equal((await api('POST', uri, { expectedVersion: 1 }, token)).status, 400);
  assert.equal((await api('POST', uri, { expectedVersion: 1, confirmed: true }, otherToken)).status, 404);
  const revoked = await api('POST', uri, { expectedVersion: 1, confirmed: true });
  assert.equal(revoked.status, 200); assert.equal(revoked.member.active, false); assert.equal(revoked.member.version, 2);
  assert.equal((await api('GET', path(a, 'products'), undefined, personToken)).status, 404);
  assert.equal((await api('GET', path(b, 'products'), undefined, personToken)).status, 200);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: invite.token }, personToken)).status, 410);
  assert.deepEqual(await User.findById(person._id).lean(), originalUser);
  const fresh = await api('POST', path(a, 'invitations'), {});
  assert.equal((await api('POST', '/saas/invitations/accept', { token: fresh.token }, personToken)).status, 200);
  assert.equal((await Membership.findById(personMember._id)).version, 3);
  const ownerMember = await Membership.findOne({ bakeryId: a._id, userId: owner._id });
  assert.equal((await api('POST', path(a, `members/${ownerMember._id}/revoke`), { expectedVersion: 1, confirmed: true })).status, 404);
});

test('expired, revoked and invalid codes fail without exposing another bakery or account', async () => {
  const expired = await api('POST', path(a, 'invitations'), {});
  await Invitation.collection.updateOne({ _id: new mongoose.Types.ObjectId(expired.invitation._id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await api('POST', '/saas/invitations/inspect', { token: expired.token }, otherToken)).status, 410);
  const revoked = await api('POST', path(a, 'invitations'), {});
  assert.equal((await api('POST', path(a, `invitations/${revoked.invitation._id}/revoke`), { confirmed: true, expectedVersion: 1 })).status, 200);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: revoked.token }, otherToken)).status, 410);
  assert.equal((await api('POST', '/saas/invitations/inspect', { token: '0'.repeat(64) }, otherToken)).status, 410);
  assert.equal((await api('POST', '/saas/invitations/inspect', { token: { $ne: null } }, otherToken)).status, 400);
});

test('one unused invitation cannot be consumed by two different signed-in users', async () => {
  const users = await User.create([{ name: 'Invite contender 1' }, { name: 'Invite contender 2' }]);
  const created = await api('POST', path(a, 'invitations'), {});
  const results = await Promise.all(users.map(user => api('POST', '/saas/invitations/accept', { token: created.token }, signToken(user))));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 410]);
  assert.equal(await Membership.countDocuments({ bakeryId: a._id, userId: { $in: users.map(user => user._id) } }), 1);
});

test('a failed audit rolls back invitation acceptance and leaves the code usable', async () => {
  const user = await User.create({ name: 'Rollback join' }), credentials = signToken(user);
  const created = await api('POST', path(a, 'invitations'), {});
  const create = Audit.create; Audit.create = async () => { throw new Error('Synthetic invitation audit failure'); };
  try { assert.equal((await api('POST', '/saas/invitations/accept', { token: created.token }, credentials)).status, 500); }
  finally { Audit.create = create; }
  assert.equal(await Membership.countDocuments({ bakeryId: a._id, userId: user._id }), 0);
  assert.equal((await Invitation.findById(created.invitation._id)).acceptedBy, null);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: created.token }, credentials)).status, 200);
});

test('invitation attempt limits are account scoped and return no token data', async () => {
  const user = await User.create({ name: 'Rate-limit test' }), credentials = signToken(user);
  for (let i = 0; i < 20; i++) assert.equal((await api('POST', '/saas/invitations/inspect', { token: '1'.repeat(64) }, credentials)).status, 410);
  const limited = await api('POST', '/saas/invitations/inspect', { token: '1'.repeat(64) }, credentials);
  assert.equal(limited.status, 429); assert.equal(limited.token, undefined);
  assert.equal((await api('POST', '/saas/invitations/inspect', { token: '1'.repeat(64) })).status, 410);
});

test('active invite and member caps are enforced atomically without consuming a rejected code', async () => {
  const outstanding = [];
  for (let i = 0; i < 20; i++) { const created = await api('POST', path(a, 'invitations'), {}); assert.equal(created.status, 201); outstanding.push(created); }
  assert.equal((await api('POST', path(a, 'invitations'), {})).status, 409);
  const count = await Membership.countDocuments({ bakeryId: a._id, active: true });
  const fill = await User.insertMany(Array.from({ length: 50 - count }, (_, i) => ({ name: `Quota fixture ${i}` })));
  await Membership.insertMany(fill.map(user => ({ bakeryId: a._id, userId: user._id, role: 'staff', active: true })));
  const newUser = await User.create({ name: 'Over-quota join' }), credentials = signToken(newUser);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: outstanding[0].token }, credentials)).status, 409);
  assert.equal((await Invitation.findById(outstanding[0].invitation._id)).acceptedBy, null);
  const member = await Membership.findOne({ bakeryId: a._id, userId: fill[0]._id });
  assert.equal((await api('POST', path(a, `members/${member._id}/revoke`), { expectedVersion: 1, confirmed: true })).status, 200);
  assert.equal((await api('POST', '/saas/invitations/accept', { token: outstanding[0].token }, credentials)).status, 200);
  assert.equal(await Membership.countDocuments({ bakeryId: a._id, active: true }), 50);
});
