const ApiError = require('../utils/ApiError');
const LIMITS = Object.freeze({ products: 500, materials: 1000, recipes: 500, revisionsPerRecipe: 100, events: 500, orders: 10000, productionRuns: 5000, materialMovements: 50000, wasteEntries: 10000, customers: 5000 });
// Draft, unpriced local fixtures. These are not published commercial offers.
const PLANS = Object.freeze({
  starter: Object.freeze({ name: 'Starter preview', limits: Object.freeze({ products: 100, materials: 250, recipes: 100, revisionsPerRecipe: 50, events: 100, orders: 2500, productionRuns: 1000, materialMovements: 10000, wasteEntries: 2000, customers: 1000 }) }),
  growth: Object.freeze({ name: 'Growth preview', limits: LIMITS }),
});
function subscriptionPolicy(value, now = new Date()) {
  if (!value) return { policy: 'development', planId: null, planName: 'Development workspace', access: 'development', writable: true, limits: LIMITS };
  const plan = Object.hasOwn(PLANS, value.planId) ? PLANS[value.planId] : null; let access = 'restricted';
  const future = date => date && Number.isFinite(new Date(date).getTime()) && new Date(date) > now;
  if (plan && value.status === 'trialing' && future(value.trialEndsAt)) access = 'trial';
  if (plan && value.status === 'active' && future(value.currentPeriodEndsAt)) access = 'active';
  if (plan && value.status === 'past_due' && future(value.graceEndsAt) && value.currentPeriodEndsAt && new Date(value.graceEndsAt) <= new Date(new Date(value.currentPeriodEndsAt).getTime() + 7 * 86400000)) access = 'grace';
  return { policy: 'subscription-preview', planId: plan ? value.planId : null, planName: plan?.name || 'Plan requires review', access, writable: access !== 'restricted', limits: plan?.limits || PLANS.starter.limits };
}
function assertSubscriptionWritable(value, now) {
  if (!subscriptionPolicy(value, now).writable) throw new ApiError(409, 'This workspace plan is restricted. Existing orders, payments and access revocation remain available', { code: 'SAAS_SUBSCRIPTION_RESTRICTED' });
}
module.exports = { LIMITS, PLANS, subscriptionPolicy, assertSubscriptionWritable };
