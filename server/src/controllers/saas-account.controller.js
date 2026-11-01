const actions = require('../saas/account-actions');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const Account = require('../models/SaasAccount');
const Session = require('../models/SaasAccountSession');
const Audit = require('../models/SaasAccountAudit');
const { fields, text } = require('../saas/recipe-input');
const { passwordOf, hashPassword, matches } = require('../saas/customer-password');
const access = require('../saas/account-access');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const view = account => ({ id: String(account._id), displayName: account.displayName, email: account.email, emailVerified: Boolean(account.emailVerified) });
async function ready() { await Promise.all([Account.init(), Session.init(), Audit.init()]); }
async function authenticate(req, res, register) {
 fields(req.body, ['email', 'password', ...(register ? ['displayName', 'confirmed'] : [])]);
 const email = text(req.body.email, 'email', 254).toLowerCase(), password = passwordOf(req.body.password);
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError.badRequest('Enter a valid email');
 if (register && req.body.confirmed !== true) throw ApiError.badRequest('Confirm creating this workspace account');
 const displayName = register ? text(req.body.displayName, 'displayName', 120) : null;
 const previous = register ? null : await Account.findOne({ email }).select('+passwordHash').lean();
 if (!register && (!await matches(password, previous?.passwordHash) || !previous?.active)) throw ApiError.unauthorized('Email or password is incorrect');
 const passwordHash = register ? await hashPassword(password) : previous.passwordHash; await ready();
 const session = await mongoose.startSession(), token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 12 * 3600000); let account;
 try { await session.withTransaction(async () => {
  if (register) { [account] = await Account.create([{ email, displayName, passwordHash }], { session }); await Audit.create([{ accountId: account._id, action: 'register' }], { session }); }
  else { account = await Account.findOneAndUpdate({ _id: previous._id, active: true, passwordHash }, { $inc: { __v: 1 } }, { session, new: true }); if (!account) throw ApiError.unauthorized('Email or password is incorrect'); }
  const old = await Session.find({ accountId: account._id }).sort({ createdAt: -1, _id: -1 }).skip(4).select('_id').session(session).lean();
  if (old.length) await Session.deleteMany({ accountId: account._id, _id: { $in: old.map(row => row._id) } }, { session });
  const [login] = await Session.create([{ accountId: account._id, tokenHash: access.digest(token), sessionVersion: account.sessionVersion, expiresAt }], { session });
  await Audit.create([{ accountId: account._id, action: 'login', sessionId: login._id }], { session });
 }); } catch (error) { if (error.code === 11000) throw ApiError.conflict('Cannot create this workspace account. Try signing in instead'); throw error; } finally { await session.endSession(); }
 res.cookie(access.COOKIE, token, { ...access.options(), expires: expiresAt }); res.status(register ? 201 : 200).json({ account: view(account) });
}
const register = asyncHandler((req, res) => authenticate(req, res, true));
const login = asyncHandler((req, res) => authenticate(req, res, false));
const authenticateAccount = asyncHandler(async (req, res, next) => { const current = await access.resolve(req); if (req.path !== '/me' && req.get('X-Saas-Account-Id') !== String(current.account._id)) throw new ApiError(409, 'The workspace account changed. Sign in again', { code: 'SAAS_ACCOUNT_CHANGED' }); req.saasAccount = current.account; req.workspaceAccountContext = current.context; next(); });
const me = (req, res) => res.json({ account: view(req.saasAccount) });
const sessions = asyncHandler(async (req, res) => { fields(req.query, []); const rows = await Session.find({ accountId: req.saasAccount._id, sessionVersion: req.saasAccount.sessionVersion, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1, _id: -1 }).limit(5).lean(); res.json({ sessions: rows.map(row => ({ _id: row._id, createdAt: row.createdAt, expiresAt: row.expiresAt, current: String(row._id) === req.workspaceAccountContext.sessionId })) }); });
const changePassword = asyncHandler(async (req, res) => {
 fields(req.body, ['currentPassword', 'newPassword', 'confirmed']); if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm changing the password and revoking all workspace sessions');
 const oldPassword = passwordOf(req.body.currentPassword), newPassword = passwordOf(req.body.newPassword); if (oldPassword === newPassword) throw ApiError.badRequest('Choose a different new password');
 const previous = await Account.findById(req.saasAccount._id).select('+passwordHash').lean(); if (!await matches(oldPassword, previous?.passwordHash)) throw ApiError.badRequest('Current password is incorrect');
 const hash = await hashPassword(newPassword); await ready(); await actions.ready();
 await access.accountWrite(req.workspaceAccountContext, async (session, account) => {
  if (!await Account.exists({ _id: account._id, passwordHash: previous.passwordHash }).session(session)) throw ApiError.conflict('Account credentials changed. Sign in again');
  account.passwordHash = hash; account.sessionVersion++; await account.save({ session }); await Session.deleteMany({ accountId: account._id }, { session });
  await actions.invalidate(session, account._id);
  await Audit.create([{ accountId: account._id, action: 'password.change' }], { session });
 }); res.json({ success: true, message: 'Password changed. Sign in again; all workspace sessions were revoked' });
});
const logout = asyncHandler(async (req, res) => {
 fields(req.body, []); const expected = req.get('X-Saas-Account-Id'); if (!/^[a-f0-9]{24}$/i.test(expected || '')) throw ApiError.badRequest('Confirm the workspace account to sign out');
 const token = req.cookies?.[access.COOKIE]; await ready();
 if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
   const row = await Session.findOne({ tokenHash: access.digest(token) }).session(session); if (!row) return;
   if (String(row.accountId) !== expected) throw new ApiError(409, 'The workspace account changed. Sign in again', { code: 'SAAS_ACCOUNT_CHANGED' });
   // Account first, as in login/password changes; no business bakery is locked.
   await Account.findOneAndUpdate({ _id: row.accountId }, { $inc: { __v: 1 } }, { session });
   const removed = await Session.deleteOne({ _id: row._id, accountId: row.accountId }, { session }); if (removed.deletedCount) await Audit.create([{ accountId: row.accountId, action: 'logout', sessionId: row._id }], { session });
  }); } finally { await session.endSession(); }
 }
 res.clearCookie(access.COOKIE, access.options()); res.json({ success: true });
});
module.exports = { register, login, authenticateAccount, me, sessions, changePassword, logout };
