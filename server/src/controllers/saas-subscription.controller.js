const Bakery = require('../models/Bakery');
const Change = require('../models/SaasSubscriptionChange');
const { subscriptionPolicy } = require('../saas/plan-policy');
const { fields } = require('../saas/recipe-input');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const get = asyncHandler(async (req, res) => {
  fields(req.query, []);
  const bakery = await Bakery.findById(req.bakeryContext.bakeryId).lean();
  if (!bakery) throw ApiError.notFound('Bakery not found');
  res.json({ success: true, subscription: bakery.subscription || null, ...subscriptionPolicy(bakery.subscription), billingConnected: false, testBillingConfigured: require('../saas/billing-provider').configured() });
});
const history = asyncHandler(async (req, res) => {
  fields(req.query, ['cursor']); const cursor = req.query.cursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor))) throw ApiError.badRequest('Invalid subscription history cursor');
  const rows = await Change.find({ bakeryId: req.bakeryContext.bakeryId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(21).lean();
  const more = rows.length > 20; if (more) rows.pop();
  res.json({ success: true, entries: rows.map(row => ({ _id: row._id, before: row.before, after: row.after, reason: row.reason, createdAt: row.createdAt })), nextCursor: more ? String(rows.at(-1)._id) : null });
});
module.exports = { get, history };
