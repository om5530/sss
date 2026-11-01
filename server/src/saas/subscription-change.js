const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const User = require('../models/User');
const Change = require('../models/SaasSubscriptionChange');
const { fields, integer, text } = require('./recipe-input');
const { PLANS, subscriptionPolicy } = require('./plan-policy');
const { sourceChecksum } = require('./migration-manifest');
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const { auditReady, recordAudit } = require('./audit');
const ApiError = require('../utils/ApiError');
const dateOf = (value, name) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw ApiError.badRequest(`Invalid ${name}`);
  return value;
};
function inputOf(body) {
  fields(body, ['planId', 'status', 'trialEndsAt', 'currentPeriodEndsAt', 'graceEndsAt', 'cancelAtPeriodEnd', 'expectedVersion', 'idempotencyKey', 'reason']);
  if (typeof body.planId !== 'string' || !Object.hasOwn(PLANS, body.planId) || !['trialing', 'active', 'past_due', 'cancelled'].includes(body.status)) throw ApiError.badRequest('Invalid local plan or subscription status');
  if (typeof body.cancelAtPeriodEnd !== 'boolean') throw ApiError.badRequest('Specify cancelAtPeriodEnd');
  if (typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 plan change key is required');
  const data = { planId: body.planId, status: body.status, trialEndsAt: dateOf(body.trialEndsAt, 'trialEndsAt'), currentPeriodEndsAt: dateOf(body.currentPeriodEndsAt, 'currentPeriodEndsAt'), graceEndsAt: dateOf(body.graceEndsAt, 'graceEndsAt'), cancelAtPeriodEnd: body.cancelAtPeriodEnd };
  if ((data.status === 'trialing' && !data.trialEndsAt) || (['active', 'past_due'].includes(data.status) && !data.currentPeriodEndsAt)
    || (data.graceEndsAt && (data.status !== 'past_due' || !data.currentPeriodEndsAt || new Date(data.graceEndsAt) < new Date(data.currentPeriodEndsAt) || new Date(data.graceEndsAt) > new Date(new Date(data.currentPeriodEndsAt).getTime() + 7 * 86400000)))
    || (data.cancelAtPeriodEnd && !['active', 'trialing'].includes(data.status))) throw ApiError.badRequest('Subscription dates or cancellation terms require review');
  return { data, expectedVersion: integer(body.expectedVersion, 'expectedVersion', 0, Number.MAX_SAFE_INTEGER - 1), idempotencyKey: body.idempotencyKey.toLowerCase(), reason: text(body.reason, 'reason', 500) };
}
function guard() { if (!foundationAvailable() || !foundationDatabaseAllowed(mongoose.connection)) throw ApiError.forbidden('Plan changes require the guarded disposable local SaaS database'); }
async function changeSubscription({ bakeryId, actorId, body, apply = false }) {
  guard(); if (![bakeryId, actorId].every(id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id))) throw ApiError.badRequest('Bakery and operator IDs are required');
  const input = inputOf(body), hash = sourceChecksum({ ...input, actorId: actorId.toLowerCase() });
  if (apply) await Promise.all([Change.init(), auditReady()]);
  const session = await mongoose.startSession(); let result;
  try { await session.withTransaction(async () => {
    const bakery = apply ? await Bakery.findOneAndUpdate({ _id: bakeryId, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true }) : await Bakery.findOne({ _id: bakeryId, status: 'active' }).session(session);
    if (!bakery || !await User.exists({ _id: actorId }).session(session)) throw ApiError.notFound('Local bakery or operator not found');
    if (bakery.billingCheckoutId) throw ApiError.conflict('Use test billing reconciliation for this provider-linked workspace');
    const previous = await Change.findOne({ bakeryId, operationKey: input.idempotencyKey }).select('+requestHash').session(session).lean();
    if (previous) {
      if (previous.requestHash !== hash) throw ApiError.conflict('Plan change key already used for another request');
      result = { replayed: true, applied: apply, before: previous.before, after: previous.after, current: bakery.subscription || null, policy: subscriptionPolicy(bakery.subscription) }; return;
    }
    const before = bakery.subscription?.toObject() || null;
    if ((before?.version || 0) !== input.expectedVersion) throw ApiError.conflict('Subscription changed. Review its current version');
    const after = { ...input.data, version: input.expectedVersion + 1 };
    result = { replayed: false, applied: apply, before, after, policy: subscriptionPolicy(after) };
    if (!apply) return;
    bakery.subscription = after; await bakery.save({ session });
    await Change.create([{ bakeryId, actorId, operationKey: input.idempotencyKey, requestHash: hash, before, after, reason: input.reason }], { session });
    await recordAudit(session, { bakeryId, actorId, actorType: 'platform', action: 'subscription.change', entityId: bakery._id, fromVersion: input.expectedVersion, toVersion: after.version, fields: ['subscription'] });
  }, apply ? {} : { readConcern: { level: 'snapshot' } }); return result; } finally { await session.endSession(); }
}
module.exports = { inputOf, changeSubscription };
