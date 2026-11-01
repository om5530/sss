const { identityFilter, freshAccount } = require('./account-access');
const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Membership = require('../models/BakeryMembership');
const { assertSubscriptionWritable } = require('./plan-policy');
const ApiError = require('../utils/ApiError');

// Writing the authorization records inside the transaction serializes changes
// against revocation/suspension; a middleware-only read can become stale.
async function bakeryWrite(context, roles, write, options = {}) {
  if (!context || !roles.includes(context.role)) throw ApiError.forbidden('Active bakery access is required');
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // Always acquire the bakery before any membership. Team revocation can
      // touch another member, so one lock order avoids owner/staff cycles.
      const bakery = await Bakery.findOneAndUpdate({ _id: context.bakeryId, status: 'active' },
        { $inc: { __v: 1 } }, { session, new: true });
      if (!bakery) throw ApiError.notFound('Bakery not found');
      if (context.identityType === 'saas') await freshAccount(session, context);
      const member = await Membership.findOneAndUpdate({ bakeryId: context.bakeryId, userId: context.userId, ...identityFilter(context.identityType), role: { $in: roles }, active: true },
        { $inc: { __v: 1 } }, { session, new: true });
      if (!member) throw ApiError.forbidden('Bakery access is no longer active');
      result = await write(session, bakery);
      // Existing idempotent submissions may replay after expiry. Every other
      // non-recovery write rolls back atomically when the plan is restricted.
      if (!options.recovery && result?.replayed !== true) assertSubscriptionWritable(bakery.subscription);
    });
    return result;
  } finally { await session.endSession(); }
}
const ownerWrite = (context, write, options) => bakeryWrite(context, ['owner'], write, options);
const memberWrite = (context, write, options) => bakeryWrite(context, ['owner', 'staff'], write, options);
module.exports = { ownerWrite, memberWrite };
