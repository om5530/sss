const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const Action = require('../models/SaasAccountAction');
const Preview = require('../models/SaasAccountMailPreview');
const Audit = require('../models/SaasAccountAudit');
const Session = require('../models/SaasAccountSession');
const { digest } = require('./account-access');
const { encryptToken } = require('./account-mail-preview');
async function ready() { await Promise.all([Action.init(), Preview.init(), Audit.init(), Session.init()]); }
async function invalidate(session, accountId, purpose) {
 const filter = { accountId, ...(purpose ? { purpose } : {}) };
 await Action.updateMany({ ...filter, consumedAt: null }, { $set: { consumedAt: new Date() } }, { session }); await Preview.deleteMany(filter, { session });
}
async function issue(session, account, purpose, key) {
 if (purpose === 'email_verify' && (account.emailVerified || account.emailPreviewConfirmedAt)) return;
 const now = new Date();
 if (await Action.exists({ accountId: account._id, purpose, createdAt: { $gt: new Date(now.getTime() - 60000) } }).session(session)) return;
 const token = randomBytes(32).toString('hex'), actionId = new mongoose.Types.ObjectId(), expiresAt = new Date(now.getTime() + (purpose === 'password_reset' ? 15 : 30) * 60000);
 await invalidate(session, account._id, purpose);
 const context = { accountId: account._id, actionId, purpose };
 await Action.create([{ _id: actionId, accountId: account._id, purpose, deliveryMode: 'local-preview', tokenHash: digest(token), sessionVersion: account.sessionVersion, expiresAt }], { session });
 await Preview.create([{ ...context, ...encryptToken(token, context, key), expiresAt }], { session });
 await Audit.create([{ accountId: account._id, action: purpose === 'password_reset' ? 'password.requestReset' : 'email.requestPreview' }], { session });
}
module.exports = { ready, invalidate, issue };
