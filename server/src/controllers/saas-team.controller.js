const Account = require('../models/SaasAccount');
const { identityFilter, freshAccount } = require('../saas/account-access');
const { assertSubscriptionWritable } = require('../saas/plan-policy');
const { randomBytes, createHash } = require('node:crypto');
const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Membership = require('../models/BakeryMembership');
const User = require('../models/User');
const Invitation = require('../models/SaasInvitation');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { fields, integer } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const unavailable = () => new ApiError(410, 'Invitation is unavailable');
function tokenHash(body) {
  fields(body, ['token']);
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/i.test(body.token)) throw ApiError.badRequest('A valid staff invite code is required');
  return createHash('sha256').update(body.token.toLowerCase()).digest('hex');
}
function id(value) { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) throw ApiError.notFound('Record not found'); return value; }
function page(query) {
  fields(query, ['limit', 'cursor']); const { limit = '50', cursor } = query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)))) throw ApiError.badRequest('Invalid pagination');
  return { limit: +limit, filter: cursor ? { _id: { $lt: cursor } } : {} };
}
const bakeryView = value => ({ _id: String(value._id), name: value.name, slug: value.slug, currency: value.currency, timezone: value.timezone, version: value.version });
const inviteView = value => ({ _id: value._id, expiresAt: value.expiresAt, accepted: !!value.acceptedBy, revoked: !!value.revokedAt,
  expired: value.expiresAt.getTime() <= Date.now(), version: value.version, createdAt: value.createdAt });
async function ready() { await Promise.all([Invitation.init(), Membership.init(), auditReady()]); }
const listMembers = asyncHandler(async (req, res) => {
  const { limit, filter } = page(req.query);
  const rows = await Membership.find({ bakeryId: req.bakeryContext.bakeryId, ...filter }).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = rows.length > limit; if (more) rows.pop();
  const users = await User.find({ _id: { $in: rows.filter(row => (row.accountType || 'legacy') === 'legacy').map(row => row.userId) } }).select('name active').lean();
  const accounts = await Account.find({ _id: { $in: rows.filter(row => row.accountType === 'saas').map(row => row.userId) } }).select('displayName active').lean();
  const names = new Map([...users.map(user => [`legacy:${user._id}`, user]), ...accounts.map(account => [`saas:${account._id}`, { ...account, name: account.displayName }])]);
  res.json({ success: true, members: rows.map(row => ({ _id: row._id, userId: row.userId, name: names.get(`${row.accountType || 'legacy'}:${row.userId}`)?.name || 'Unnamed account',
    accountActive: names.get(`${row.accountType || 'legacy'}:${row.userId}`)?.active !== false && names.has(`${row.accountType || 'legacy'}:${row.userId}`), role: row.role, active: row.active, version: row.version })), nextCursor: more ? String(rows.at(-1)._id) : null });
});
const listInvitations = asyncHandler(async (req, res) => {
  const { limit, filter } = page(req.query);
  const rows = await Invitation.find({ bakeryId: req.bakeryContext.bakeryId, ...filter }).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = rows.length > limit; if (more) rows.pop();
  res.json({ success: true, invitations: rows.map(inviteView), nextCursor: more ? String(rows.at(-1)._id) : null });
});
const createInvitation = asyncHandler(async (req, res) => {
  fields(req.body, ['expiresInMinutes']);
  const minutes = req.body.expiresInMinutes === undefined ? 30 : integer(req.body.expiresInMinutes, 'expiresInMinutes', 1, 1440);
  await ready();
  const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex');
  const invitation = await ownerWrite(req.bakeryContext, async session => {
    const count = await Invitation.countDocuments({ bakeryId: req.bakeryContext.bakeryId, acceptedBy: null, revokedAt: null, expiresAt: { $gt: new Date() } }).session(session);
    if (count >= 20) throw ApiError.conflict('Resolve existing active invitations before creating more');
    const [created] = await Invitation.create([{ bakeryId: req.bakeryContext.bakeryId, createdBy: req.user._id, tokenHash: hash, expiresAt: new Date(Date.now() + minutes * 60000) }], { session });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'team.invite', entityId: created._id, fromVersion: 0, toVersion: 1, fields: ['expiresAt'] });
    return created;
  });
  res.status(201).json({ success: true, invitation: inviteView(invitation), token });
});
const revokeInvitation = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed']);
  const invitationId = id(req.params.invitationId), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm invite revocation'); await ready();
  const invitation = await ownerWrite(req.bakeryContext, async session => {
    const current = await Invitation.findOne({ _id: invitationId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Invitation not found');
    if (current.version !== expected) throw ApiError.conflict('Invitation changed. Reload before revoking');
    if (current.revokedAt) return current;
    current.revokedAt = new Date(); current.version++; await current.save({ session });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'team.revokeInvite', entityId: current._id, fromVersion: expected, toVersion: current.version, fields: ['revokedAt'] }); return current;
  }, { recovery: true });
  res.json({ success: true, invitation: inviteView(invitation) });
});
const revokeMember = asyncHandler(async (req, res) => {
  fields(req.body, ['expectedVersion', 'confirmed']);
  const memberId = id(req.params.memberId), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm staff access revocation'); await ready();
  const member = await ownerWrite(req.bakeryContext, async session => {
    const current = await Membership.findOne({ _id: memberId, bakeryId: req.bakeryContext.bakeryId, role: 'staff' }).session(session);
    if (!current) throw ApiError.notFound('Staff membership not found');
    if (current.version !== expected) throw ApiError.conflict('Membership changed. Reload before revoking');
    if (!current.active) return current;
    current.active = false; current.version++; await current.save({ session });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'team.revokeMember', entityId: current._id, fromVersion: expected, toVersion: current.version, fields: ['active'] }); return current;
  }, { recovery: true });
  res.json({ success: true, member: { _id: member._id, userId: member.userId, role: member.role, active: member.active, version: member.version } });
});
async function inspect(hash, userId, session, identityType = 'legacy') {
  let query = Invitation.findOne({ tokenHash: hash }); if (session) query = query.session(session);
  const invitation = await query;
  if (!invitation || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now() || (invitation.acceptedBy && (String(invitation.acceptedBy) !== String(userId) || (invitation.acceptedAccountType || 'legacy') !== identityType))) throw unavailable();
  let bakeryQuery = Bakery.findOne({ _id: invitation.bakeryId, status: 'active' }); if (session) bakeryQuery = bakeryQuery.session(session);
  const bakery = await bakeryQuery; if (!bakery) throw unavailable();
  let memberQuery = Membership.findOne({ bakeryId: invitation.bakeryId, userId, ...identityFilter(identityType) }); if (session) memberQuery = memberQuery.session(session);
  const member = await memberQuery;
  if (invitation.acceptedBy && !member?.active) throw unavailable();
  return { invitation, bakery, member };
}
const inspectInvitation = asyncHandler(async (req, res) => {
  const { bakery, member } = await inspect(tokenHash(req.body), req.user._id, null, req.identityType || 'legacy');
  res.json({ success: true, bakery: bakeryView(bakery), role: member?.active ? member.role : 'staff', alreadyMember: !!member?.active });
});
const acceptInvitation = asyncHandler(async (req, res) => {
  const hash = tokenHash(req.body); await ready();
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      let { invitation, bakery, member } = await inspect(hash, req.user._id, session, req.identityType || 'legacy');
      // Serialize acceptance with suspension, owner revocation and other joins.
      const active = await Bakery.findOneAndUpdate({ _id: bakery._id, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
      if (!active || invitation.expiresAt.getTime() <= Date.now()) throw unavailable();
      if (req.identityType === 'saas') await freshAccount(session, req.workspaceAccountContext);
      if (member?.active) { result = { bakery: bakeryView(bakery), role: member.role, alreadyMember: true }; return; }
      assertSubscriptionWritable(active.subscription);
      if (member?.role === 'owner' || invitation.acceptedBy) throw unavailable();
      if (await Membership.countDocuments({ bakeryId: bakery._id, active: true }).session(session) >= 50) throw ApiError.conflict('This bakery has reached its active team limit');
      const before = member?.version || 0;
      if (member) { member.active = true; member.version++; await member.save({ session }); }
      else [member] = await Membership.create([{ bakeryId: bakery._id, userId: req.user._id, accountType: req.identityType || 'legacy', role: 'staff', active: true }], { session });
      invitation.acceptedBy = req.user._id; invitation.acceptedAccountType = req.identityType || 'legacy'; invitation.acceptedAt = new Date(); invitation.version++; await invitation.save({ session });
      await recordAudit(session, { bakeryId: bakery._id, actorId: req.user._id, action: 'team.join', entityId: member._id, fromVersion: before, toVersion: member.version, fields: ['membership'] });
      result = { bakery: bakeryView(bakery), role: 'staff', alreadyMember: false };
    });
  } finally { await session.endSession(); }
  res.json({ success: true, ...result });
});
module.exports = { listMembers, listInvitations, createInvitation, revokeInvitation, revokeMember, inspectInvitation, acceptInvitation };
