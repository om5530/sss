const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const Account = require('../models/SaasAccount');
const Session = require('../models/SaasAccountSession');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const COOKIE = 'saas_workspace_session';
const options = () => ({ httpOnly: true, sameSite: 'strict', secure: require('../config/saas-staging').stagingAvailable(), path: '/api/saas' });
const digest = value => createHash('sha256').update(value).digest('hex');
function identityFilter(type = 'legacy') { return type === 'saas' ? { accountType: 'saas' } : { $or: [{ accountType: 'legacy' }, { accountType: { $exists: false } }] }; }
function actorKey(context) { const id = String(context.userId || context.user?._id); return context.identityType === 'saas' ? `saas:${id}` : id; }
function intent(req, header) {
 if (req.get(header) !== '1') throw ApiError.forbidden('Use the workspace account form');
 const staging = require('../config/saas-staging');
 const origins = staging.stagingAvailable() ? [staging.stagingOrigin(req)].filter(Boolean) : [new URL(env.clientUrl).origin, new URL(`${req.protocol}://${req.get('host')}`).origin];
 const origin = req.get('Origin'); if (origin && !origins.includes(origin)) throw ApiError.forbidden('Workspace request origin is not allowed');
}
async function resolve(req) {
 const token = req.cookies?.[COOKIE]; if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw ApiError.unauthorized('Sign in to the bakery workspace');
 const session = await Session.findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } }).lean();
 const account = session && await Account.findOne({ _id: session.accountId, active: true, sessionVersion: session.sessionVersion }).lean();
 if (!session || !account) throw ApiError.unauthorized('Workspace session expired or revoked. Sign in again');
 return { account, context: { identityType: 'saas', userId: String(account._id), sessionId: String(session._id), sessionVersion: session.sessionVersion } };
}
async function freshAccount(session, context) {
 const account = await Account.findOneAndUpdate({ _id: context.userId, active: true, sessionVersion: context.sessionVersion }, { $inc: { __v: 1 } }, { session, new: true });
 const login = account && await Session.findOne({ _id: context.sessionId, accountId: account._id, sessionVersion: context.sessionVersion, expiresAt: { $gt: new Date() } }).session(session);
 if (!account || !login) throw ApiError.unauthorized('Workspace session expired or revoked. Sign in again'); return account;
}
async function accountWrite(context, callback) {
 const session = await mongoose.startSession(); let result;
 try { await session.withTransaction(async () => { const account = await freshAccount(session, context); result = await callback(session, account); }); return result; } finally { await session.endSession(); }
}
async function requireWorkspace(req, res, next) {
 try {
  if (req.cookies?.[COOKIE] === undefined && process.env.SAAS_LEGACY_WORKSPACE_AUTH === 'true' && require('../config/saas-foundation').foundationAvailable()) return require('../middleware/auth').requireAuth(req, res, next);
  const { account, context } = await resolve(req);
  if (req.get('X-Saas-Account-Id') !== String(account._id)) throw new ApiError(409, 'The workspace account changed. Sign in again', { code: 'SAAS_ACCOUNT_CHANGED' });
  if (!['GET', 'HEAD'].includes(req.method)) intent(req, 'X-Saas-Workspace');
  req.user = { _id: account._id, name: account.displayName, email: account.email, active: account.active, sessionVersion: account.sessionVersion };
  req.identityType = 'saas'; req.workspaceAccountContext = context; next();
 } catch (error) { next(error); }
}
module.exports = { COOKIE, options, digest, identityFilter, actorKey, intent, resolve, freshAccount, accountWrite, requireWorkspace };
