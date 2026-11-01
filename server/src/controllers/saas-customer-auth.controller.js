const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const Bakery = require('../models/Bakery');
const Storefront = require('../models/SaasStorefront');
const Customer = require('../models/SaasCustomer');
const CustomerSession = require('../models/SaasCustomerSession');
const { fields, text } = require('../saas/recipe-input');
const { passwordOf, hashPassword, matches } = require('../saas/customer-password');
const { digest, cookieName, cookieOptions } = require('../saas/customer-access');
const { auditReady, recordAudit } = require('../saas/audit');
const { requireCapacity } = require('../saas/usage-limits');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const profile = row => ({ id: String(row._id), displayName: row.displayName, email: row.email, emailVerified: Boolean(row.emailVerified), emailPreviewConfirmedAt: row.emailPreviewConfirmedAt || null });
function credentials(body, registering) {
  fields(body, ['email', 'password', ...(registering ? ['displayName'] : [])]);
  const email = text(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError.badRequest('Enter a valid email');
  return { email, password: passwordOf(body.password), ...(registering ? { displayName: text(body.displayName, 'name', 120) } : {}) };
}
async function audit(session, bakeryId, actorId, action, entityId) {
  await recordAudit(session, { bakeryId, actorId, actorType: 'customer', action, entityId, fromVersion: 0, toVersion: 1, fields: ['customerId'] });
}
async function authenticate(req, res, registering) {
  const input = credentials(req.body, registering);
  // New accounts require an accepting published store. Existing customers
  // must retain account/history access when the menu is hidden or paused.
  const published = await Storefront.findOne({ bakeryId: req.storeBakery._id, published: true }).lean();
  if (registering && (!published || !published.acceptCustomerOrders)) throw ApiError.conflict('Customer accounts are unavailable for this bakery');
  let existing = null, passwordHash;
  if (registering) passwordHash = await hashPassword(input.password);
  else {
    existing = await Customer.findOne({ bakeryId: req.storeBakery._id, email: input.email }).select('+passwordHash').lean();
    if (!await matches(input.password, existing?.passwordHash) || !existing?.active) throw ApiError.unauthorized('Email or password is incorrect');
    passwordHash = existing.passwordHash;
  }
  await Promise.all([Customer.init(), CustomerSession.init(), auditReady()]);
  const session = await mongoose.startSession(), token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 12 * 3600000); let customer;
  try {
    await session.withTransaction(async () => {
      const bakery = await Bakery.findOneAndUpdate({ _id: req.storeBakery._id, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
      const settings = await Storefront.findOne({ bakeryId: req.storeBakery._id, published: true }).session(session).lean();
      if (!bakery || (registering && (!settings || !settings.acceptCustomerOrders))) throw ApiError.conflict('Customer accounts are unavailable for this bakery');
      if (registering) {
        await requireCapacity(Customer, bakery._id, 'customers', session);
        if (await Customer.exists({ bakeryId: bakery._id, email: input.email }).session(session)) throw ApiError.conflict('Cannot create an account with these details. Try signing in');
        [customer] = await Customer.create([{ bakeryId: bakery._id, email: input.email, displayName: input.displayName, passwordHash }], { session });
        await audit(session, bakery._id, customer._id, 'customer.register', customer._id);
      } else {
        customer = await Customer.findOneAndUpdate({ _id: existing._id, bakeryId: bakery._id, active: true, passwordHash }, { $inc: { __v: 1 } }, { session, new: true });
        if (!customer) throw ApiError.unauthorized('Email or password is incorrect');
      }
      const older = await CustomerSession.find({ bakeryId: bakery._id, customerId: customer._id }).sort({ createdAt: -1, _id: -1 }).skip(4).select('_id').session(session).lean();
      if (older.length) await CustomerSession.deleteMany({ bakeryId: bakery._id, customerId: customer._id, _id: { $in: older.map(row => row._id) } }, { session });
      const [created] = await CustomerSession.create([{ bakeryId: bakery._id, customerId: customer._id, tokenHash: digest(token), expiresAt, sessionVersion: customer.sessionVersion }], { session });
      await audit(session, bakery._id, customer._id, 'customer.login', created._id);
    });
  } catch (error) { if (error.details?.code === 'SAAS_SUBSCRIPTION_RESTRICTED') throw ApiError.conflict('Customer accounts are unavailable for this bakery'); if (error.code === 11000) throw ApiError.conflict('Cannot create an account with these details. Try signing in'); throw error; }
  finally { await session.endSession(); }
  res.cookie(cookieName(req.storeBakery), token, { ...cookieOptions(req.storeBakery), expires: expiresAt });
  res.status(registering ? 201 : 200).json({ success: true, customer: profile(customer) });
}
const register = asyncHandler(async (req, res) => authenticate(req, res, true));
const login = asyncHandler(async (req, res) => authenticate(req, res, false));
const me = (req, res) => res.json({ success: true, customer: profile(req.customer) });
const logout = asyncHandler(async (req, res) => {
  fields(req.body, []);
  if (!/^[a-f0-9]{24}$/i.test(req.get('X-Saas-Customer-Id') || '')) throw ApiError.badRequest('Confirm the customer account to sign out');
  await auditReady();
  const token = req.cookies?.[cookieName(req.storeBakery)];
  if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
    const session = await mongoose.startSession();
    try { await session.withTransaction(async () => {
      const bakery = await Bakery.findOneAndUpdate({ _id: req.storeBakery._id, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true });
      if (!bakery) throw ApiError.notFound('Bakery not found');
      const previous = await CustomerSession.findOne({ bakeryId: bakery._id, tokenHash: digest(token) }).session(session);
      if (previous && String(previous.customerId) !== req.get('X-Saas-Customer-Id')) throw new ApiError(409, 'The customer session changed. Sign in again', { code: 'CUSTOMER_SESSION_CHANGED' });
      if (previous) await CustomerSession.deleteOne({ _id: previous._id, bakeryId: bakery._id }, { session });
      if (previous) await audit(session, bakery._id, previous.customerId, 'customer.logout', previous._id);
    }); } finally { await session.endSession(); }
  }
  res.clearCookie(cookieName(req.storeBakery), cookieOptions(req.storeBakery)); res.json({ success: true });
});
module.exports = { register, login, me, logout };
