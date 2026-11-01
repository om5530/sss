const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Storefront = require('../models/SaasStorefront');
const Customer = require('../models/SaasCustomer');
const CustomerSession = require('../models/SaasCustomerSession');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const digest = value => createHash('sha256').update(value).digest('hex');
const cookieName = bakery => `saas_customer_${bakery._id || bakery}`;
const cookieOptions = bakery => ({ httpOnly: true, sameSite: 'strict', secure: require('../config/saas-staging').stagingAvailable(), path: `/api/saas/storefront/${bakery.slug}/customer` });
const resolveBakery = asyncHandler(async (req, _res, next) => {
  if (typeof req.params.slug !== 'string' || req.params.slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(req.params.slug)) throw ApiError.notFound('Bakery not found');
  const bakery = await Bakery.findOne({ slug: req.params.slug, status: 'active' }).lean();
  if (!bakery) throw ApiError.notFound('Bakery not found'); req.storeBakery = bakery; next();
});
function customerIntent(req, _res, next) {
  try {
    if (req.get('X-Saas-Customer') !== '1') throw ApiError.forbidden('Use the customer account form');
    const origin = req.get('Origin');
    const staging = require('../config/saas-staging');
    const origins = staging.stagingAvailable() ? [staging.stagingOrigin(req)].filter(Boolean) : [new URL(env.clientUrl).origin, new URL(`${req.protocol}://${req.get('host')}`).origin];
    if (origin && !origins.includes(origin)) throw ApiError.forbidden('Customer request origin is not allowed');
    next();
  } catch (error) { next(error); }
}
const requireCustomer = asyncHandler(async (req, _res, next) => {
  // Legacy JWTs, global users/admins and caller-supplied customer IDs never
  // identify a customer. Only this bakery's host-only, path-scoped cookie does.
  const token = req.cookies?.[cookieName(req.storeBakery)];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw ApiError.unauthorized('Sign in to this bakery');
  const session = await CustomerSession.findOne({ bakeryId: req.storeBakery._id, tokenHash: digest(token), expiresAt: { $gt: new Date() } }).lean();
  if (!session) throw ApiError.unauthorized('Sign in to this bakery');
  const customer = await Customer.findOne({ _id: session.customerId, bakeryId: req.storeBakery._id, active: true, sessionVersion: session.sessionVersion }).lean();
  if (!customer) throw ApiError.unauthorized('Sign in to this bakery');
  req.customer = customer; req.customerContext = { bakeryId: req.storeBakery._id, customerId: customer._id, sessionId: session._id, sessionVersion: session.sessionVersion };
  next();
});
async function customerWrite(context, callback) {
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const bakery = await Bakery.findOneAndUpdate({ _id: context.bakeryId, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
      if (!bakery) throw ApiError.notFound('Bakery not found');
      const customer = await Customer.findOneAndUpdate({ _id: context.customerId, bakeryId: bakery._id, active: true, sessionVersion: context.sessionVersion }, { $inc: { __v: 1 } }, { session, new: true });
      const accountSession = await CustomerSession.findOne({ _id: context.sessionId, bakeryId: bakery._id, customerId: context.customerId, sessionVersion: context.sessionVersion, expiresAt: { $gt: new Date() } }).session(session);
      if (!customer || !accountSession) throw ApiError.unauthorized('Sign in to this bakery');
      const profile = await Storefront.findOne({ bakeryId: bakery._id }).session(session).lean();
      result = await callback(session, { bakery, customer, accountSession, accepting: !!(profile?.published && profile?.acceptCustomerOrders), reservationMinutes: profile?.pickupReservationMinutes || 30 });
    });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { resolveBakery, customerIntent, requireCustomer, customerWrite, digest, cookieName, cookieOptions };
