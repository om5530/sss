const mongoose = require('mongoose');
const Account = require('../models/SaasAccount');
const Action = require('../models/SaasAccountAction');
const Session = require('../models/SaasAccountSession');
const Audit = require('../models/SaasAccountAudit');
const { fields, text } = require('../saas/recipe-input');
const { passwordOf, hashPassword } = require('../saas/customer-password');
const { accountWrite, digest } = require('../saas/account-access');
const { previewKey } = require('../saas/account-mail-preview');
const { ready, issue, invalidate } = require('../saas/account-actions');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const invalid = () => ApiError.badRequest('This workspace token is invalid, expired or already used. Request a new one');
const response = { success: true, deliveryMode: 'local-preview', message: 'If the account is eligible, a local workspace preview was queued. No email was sent' };
const requestReset = asyncHandler(async (req, res) => {
 fields(req.body, ['email']); const email = text(req.body.email, 'email', 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError.badRequest('Enter a valid email');
 const key = previewKey(); await ready(); const session = await mongoose.startSession();
 try { await session.withTransaction(async () => {
  const account = await Account.findOneAndUpdate({ email, active: true }, { $inc: { __v: 1 } }, { session, new: true }); if (account) await issue(session, account, 'password_reset', key);
 }); } finally { await session.endSession(); }
 res.json(response);
});
const requestVerification = asyncHandler(async (req, res) => { fields(req.body, []); const key = previewKey(); await ready(); await accountWrite(req.workspaceAccountContext, (session, account) => issue(session, account, 'email_verify', key)); res.json(response); });
function confirm(purpose) { return asyncHandler(async (req, res) => {
 fields(req.body, ['token', 'confirmed', ...(purpose === 'password_reset' ? ['newPassword'] : [])]);
 if (req.body.confirmed !== true) throw ApiError.badRequest('Review and confirm this workspace account action');
 if (typeof req.body.token !== 'string' || !/^[a-f0-9]{64}$/i.test(req.body.token)) throw invalid();
 const tokenHash = digest(req.body.token.toLowerCase()), passwordHash = purpose === 'password_reset' ? await hashPassword(passwordOf(req.body.newPassword)) : null;
 await ready(); const session = await mongoose.startSession();
 try { await session.withTransaction(async () => {
  const action = await Action.findOne({ tokenHash, purpose, deliveryMode: 'local-preview', consumedAt: null, expiresAt: { $gt: new Date() } }).session(session); if (!action) throw invalid();
  const account = await Account.findOneAndUpdate({ _id: action.accountId, active: true, sessionVersion: action.sessionVersion }, { $inc: { __v: 1 } }, { session, new: true }); if (!account) throw invalid();
  if (purpose === 'password_reset') {
   account.passwordHash = passwordHash; account.sessionVersion++; await account.save({ session });
   await Session.deleteMany({ accountId: account._id }, { session }); await invalidate(session, account._id);
  } else {
   // An operator preview is not mailbox proof and cannot enable verified status.
   account.emailPreviewConfirmedAt = new Date(); await account.save({ session }); await invalidate(session, account._id, 'email_verify');
  }
  await Audit.create([{ accountId: account._id, action: purpose === 'password_reset' ? 'password.reset' : 'email.confirmPreview' }], { session });
 }); } finally { await session.endSession(); }
 // Bearer proof never signs in or clears a different current cookie identity.
 res.json({ success: true, deliveryMode: 'local-preview', message: purpose === 'password_reset' ? 'Workspace password reset. Sign in again; all earlier workspace sessions were revoked' : 'Workspace verification preview completed. Real email ownership remains unverified' });
}); }
module.exports = { requestReset, requestVerification, confirmReset: confirm('password_reset'), confirmVerification: confirm('email_verify') };
