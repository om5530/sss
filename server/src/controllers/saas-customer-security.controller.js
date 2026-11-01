const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Customer = require('../models/SaasCustomer');
const Action = require('../models/SaasCustomerAction');
const { fields, text } = require('../saas/recipe-input');
const { passwordOf, hashPassword, matches } = require('../saas/customer-password');
const { digest, customerWrite } = require('../saas/customer-access');
const { previewKey } = require('../saas/customer-mail-preview');
const { actionsReady, issue, invalidateActions, revokeSessions } = require('../saas/customer-actions');
const { recordAudit } = require('../saas/audit');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const invalid = () => ApiError.badRequest('This account token is invalid, expired or already used. Request a new one');
const genericRequest = { success: true, deliveryMode: 'local-preview', message: 'If the account is eligible, a local preview was queued. No email was sent' };
const requestReset = asyncHandler(async (req, res) => {
  fields(req.body, ['email']); const email = text(req.body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError.badRequest('Enter a valid email');
  const key = previewKey(); await actionsReady(); const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const bakery = await Bakery.findOneAndUpdate({ _id: req.storeBakery._id, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
    if (!bakery) throw ApiError.notFound('Bakery not found');
    const customer = await Customer.findOneAndUpdate({ bakeryId: bakery._id, email, active: true }, { $inc: { __v: 1 } }, { session, new: true });
    if (customer) await issue(session, bakery._id, customer, 'password_reset', key);
  }); } finally { await session.endSession(); }
  res.json(genericRequest);
});
const requestVerification = asyncHandler(async (req, res) => {
  fields(req.body, []); const key = previewKey(); await actionsReady();
  await customerWrite(req.customerContext, (session, current) => issue(session, current.bakery._id, current.customer, 'email_verify', key));
  res.json(genericRequest);
});
function confirm(purpose) { return asyncHandler(async (req, res) => {
  fields(req.body, ['token', ...(purpose === 'password_reset' ? ['newPassword'] : [])]);
  if (typeof req.body.token !== 'string' || !/^[a-f0-9]{64}$/i.test(req.body.token)) throw invalid();
  const tokenHash = digest(req.body.token.toLowerCase());
  const passwordHash = purpose === 'password_reset' ? await hashPassword(passwordOf(req.body.newPassword)) : null;
  await actionsReady(); const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const bakery = await Bakery.findOneAndUpdate({ _id: req.storeBakery._id, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
    if (!bakery) throw invalid();
    const action = await Action.findOne({ bakeryId: bakery._id, tokenHash, purpose, consumedAt: null, expiresAt: { $gt: new Date() } }).session(session);
    if (!action) throw invalid();
    const customer = await Customer.findOneAndUpdate({ _id: action.customerId, bakeryId: bakery._id, active: true, sessionVersion: action.sessionVersion }, { $inc: { __v: 1 } }, { session, new: true });
    if (!customer) throw invalid();
    const before = customer.sessionVersion;
    if (purpose === 'password_reset') { customer.passwordHash = passwordHash; await revokeSessions(session, customer); }
    else {
      // Operator preview possession is not evidence of real mailbox ownership.
      customer.emailPreviewConfirmedAt = new Date(); await customer.save({ session });
      await invalidateActions(session, bakery._id, customer._id, 'email_verify');
    }
    await recordAudit(session, { bakeryId: bakery._id, actorId: customer._id, actorType: 'customer', action: purpose === 'password_reset' ? 'customer.resetPassword' : 'customer.previewVerification', entityId: customer._id,
      fromVersion: before, toVersion: customer.sessionVersion, fields: [purpose === 'password_reset' ? 'sessionVersion' : 'emailPreviewConfirmedAt'] });
  }); } finally { await session.endSession(); }
  res.json({ success: true, deliveryMode: 'local-preview', message: purpose === 'password_reset' ? 'Password reset. Sign in again; earlier sessions were revoked' : 'Local verification preview completed. Real email ownership remains unverified' });
}); }
const changePassword = asyncHandler(async (req, res) => {
  fields(req.body, ['currentPassword', 'newPassword', 'confirmed']);
  if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm changing the password and signing out all sessions at this bakery');
  const currentPassword = passwordOf(req.body.currentPassword), newPassword = passwordOf(req.body.newPassword);
  if (currentPassword === newPassword) throw ApiError.badRequest('Choose a different new password');
  const previous = await Customer.findOne({ _id: req.customer._id, bakeryId: req.storeBakery._id, active: true }).select('+passwordHash').lean();
  if (!await matches(currentPassword, previous?.passwordHash)) throw ApiError.badRequest('Current password is incorrect');
  const passwordHash = await hashPassword(newPassword); await actionsReady();
  await customerWrite(req.customerContext, async (session, current) => {
    if (!await Customer.exists({ _id: current.customer._id, bakeryId: current.bakery._id, passwordHash: previous.passwordHash }).session(session)) throw ApiError.conflict('Account credentials changed. Sign in again');
    const before = current.customer.sessionVersion; current.customer.passwordHash = passwordHash; await revokeSessions(session, current.customer);
    await recordAudit(session, { bakeryId: current.bakery._id, actorId: current.customer._id, actorType: 'customer', action: 'customer.changePassword', entityId: current.customer._id, fromVersion: before, toVersion: current.customer.sessionVersion, fields: ['sessionVersion'] });
  });
  res.json({ success: true, message: 'Password changed. Sign in again; earlier sessions were revoked' });
});
module.exports = { requestReset, requestVerification, confirmReset: confirm('password_reset'), confirmVerification: confirm('email_verify'), changePassword };
