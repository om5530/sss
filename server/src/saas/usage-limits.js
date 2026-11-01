const ApiError = require('../utils/ApiError');
const Bakery = require('../models/Bakery');
const { LIMITS, subscriptionPolicy, assertSubscriptionWritable } = require('./plan-policy');
async function requireCapacity(Model, bakeryId, resource, session, extraFilter = {}) {
  const bakery = await Bakery.findById(bakeryId).select('subscription').session(session).lean();
  if (!bakery) throw ApiError.notFound('Bakery not found');
  assertSubscriptionWritable(bakery.subscription);
  const limit = subscriptionPolicy(bakery.subscription).limits[resource];
  if (!Number.isSafeInteger(limit)) throw new Error('Unknown SaaS capacity policy');
  // Call after ownerWrite/memberWrite acquires the bakery lock. The count and
  // insertion then share one transaction, including concurrent staff sales.
  const used = await Model.countDocuments({ ...extraFilter, bakeryId }).session(session);
  if (used >= limit) throw new ApiError(409, `The workspace limit for ${resource} has been reached`, { code: 'SAAS_LIMIT_REACHED', resource, limit });
}
module.exports = { LIMITS, requireCapacity };
