const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const Action = require('../models/SaasCustomerAction');
const Preview = require('../models/SaasCustomerMailPreview');
const Session = require('../models/SaasCustomerSession');
const { digest } = require('./customer-access');
const { encryptToken } = require('./customer-mail-preview');
const { auditReady, recordAudit } = require('./audit');
async function actionsReady() { await Promise.all([Action.init(), Preview.init(), Session.init(), auditReady()]); }
async function issue(session, bakeryId, customer, purpose, key) {
  const now = new Date();
  // Uniform public request response even when no new message is generated.
  if (purpose === 'email_verify' && (customer.emailVerified || customer.emailPreviewConfirmedAt)) return;
  if (await Action.exists({ bakeryId, customerId: customer._id, purpose, createdAt: { $gt: new Date(now.getTime() - 60000) } }).session(session)) return;
  const token = randomBytes(32).toString('hex'), actionId = new mongoose.Types.ObjectId(), expiresAt = new Date(now.getTime() + (purpose === 'password_reset' ? 15 : 30) * 60000);
  const context = { bakeryId, customerId: customer._id, actionId, purpose };
  await Action.updateMany({ bakeryId, customerId: customer._id, purpose, consumedAt: null }, { $set: { consumedAt: now } }, { session });
  await Action.create([{ _id: actionId, bakeryId, customerId: customer._id, purpose, tokenHash: digest(token), deliveryMode: 'local-preview', sessionVersion: customer.sessionVersion, expiresAt }], { session });
  await Preview.create([{ ...context, ...encryptToken(token, context, key), expiresAt }], { session });
  await recordAudit(session, { bakeryId, actorId: customer._id, actorType: 'customer', action: purpose === 'password_reset' ? 'customer.requestReset' : 'customer.requestVerification', entityId: actionId, fromVersion: 0, toVersion: 1, fields: ['purpose'] });
}
async function invalidateActions(session, bakeryId, customerId, purpose) {
  const filter = { bakeryId, customerId, ...(purpose ? { purpose } : {}) };
  await Action.updateMany({ ...filter, consumedAt: null }, { $set: { consumedAt: new Date() } }, { session });
  await Preview.deleteMany(filter, { session });
}
async function revokeSessions(session, customer) {
  customer.sessionVersion++; await customer.save({ session });
  await Session.deleteMany({ bakeryId: customer.bakeryId, customerId: customer._id }, { session });
  await invalidateActions(session, customer.bakeryId, customer._id);
}
module.exports = { actionsReady, issue, invalidateActions, revokeSessions };
