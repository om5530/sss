const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Checkout = require('../models/SaasBillingCheckout');
const Invoice = require('../models/SaasBillingInvoice');
const Event = require('../models/SaasBillingEvent');
const Change = require('../models/SaasSubscriptionChange');
const provider = require('./billing-provider');
const { actorKey } = require('./account-access');
const { ownerWrite } = require('./owner-write');
const { sourceChecksum } = require('./migration-manifest');
const { auditReady, recordAudit } = require('./audit');
const ApiError = require('../utils/ApiError');
const TERMINAL = ['cancelled', 'completed', 'expired'];
const SELECT = '+keyId +accountId +hostedUrl +requestHash';
async function ready() { await Promise.all([Checkout.init(), Invoice.init(), Event.init(), Change.init(), auditReady()]); }
function view(row) { return row ? { _id: row._id, planId: row.planId, amountPaise: row.amountPaise, cycles: row.cycles, phase: row.phase, version: row.version, providerSubscriptionId: row.providerSubscriptionId || null, providerStatus: row.providerStatus, paidThrough: row.paidThrough, cancelState: row.cancelState, hostedUrl: row.phase === 'ready' ? provider.safeLink(row.hostedUrl) : null, synchronizedAt: row.synchronizedAt || null } : null; }
function integration(row) { const config = provider.configuration(); if (config.keyId !== row.keyId || config.accountId !== row.accountId) throw ApiError.conflict('Billing integration changed. Restore its original test account before reconciliation'); }
function validateSubscription(row, sub) {
 integration(row);
 if (!sub || !/^sub_[a-zA-Z0-9]+$/.test(sub.id || '') || (row.providerSubscriptionId && sub.id !== row.providerSubscriptionId) || sub.plan_id !== row.providerPlanId || sub.quantity !== 1 || sub.total_count !== 12 || sub.notes?.saas_checkout !== String(row._id) || sub.notes?.saas_bakery !== String(row.bakeryId) || sub.notes?.saas_mode !== 'test' || !['created', 'authenticated', 'active', 'pending', 'halted', 'paused', ...TERMINAL].includes(sub.status)) throw ApiError.conflict('Provider subscription does not match this checkout');
}
async function entitlement(session, bakery, row, state, reason) {
 const before = bakery.subscription?.toObject() || null;
 const comparable = value => JSON.stringify({ planId: value?.planId, status: value?.status, trialEndsAt: value?.trialEndsAt || null, currentPeriodEndsAt: value?.currentPeriodEndsAt ? new Date(value.currentPeriodEndsAt).toISOString() : null, graceEndsAt: value?.graceEndsAt ? new Date(value.graceEndsAt).toISOString() : null, cancelAtPeriodEnd: value?.cancelAtPeriodEnd || false });
 if (comparable(before) === comparable(state)) return;
 const after = { ...state, version: (before?.version || 0) + 1 }; bakery.subscription = after; await bakery.save({ session });
 await Change.create([{ bakeryId: bakery._id, actorId: row.actorId, operationKey: `billing:${row._id}:${after.version}`, requestHash: sourceChecksum(JSON.parse(JSON.stringify(after))), before, after, reason }], { session });
 await recordAudit(session, { bakeryId: bakery._id, actorId: row.actorId, actorType: 'platform', action: 'subscription.change', entityId: bakery._id, fromVersion: before?.version || 0, toVersion: after.version, fields: ['subscription'] });
}
async function platformWrite(bakeryId, callback) {
 provider.configuration(); const session = await mongoose.startSession(); let result;
 try { await session.withTransaction(async () => { const bakery = await Bakery.findOneAndUpdate({ _id: bakeryId, status: 'active' }, { $inc: { __v: 1 } }, { session, new: true }); if (!bakery) throw ApiError.notFound('Bakery not found'); result = await callback(session, bakery); }); return result; } finally { await session.endSession(); }
}
async function attach(context, checkoutId, sub) {
 return ownerWrite(context, async (session, bakery) => {
  const row = await Checkout.findOne({ _id: checkoutId, bakeryId: context.bakeryId, current: true }).select(SELECT).session(session);
  if (!row || String(bakery.billingCheckoutId) !== String(row._id)) throw ApiError.notFound('Current checkout not found'); validateSubscription(row, sub);
  if (row.phase === 'ready') return row;
  const url = provider.safeLink(sub.short_url); if (!url) throw ApiError.conflict('Provider checkout link requires review');
  const before = row.version; row.phase = 'ready'; row.providerSubscriptionId = sub.id; row.hostedUrl = url; row.providerStatus = sub.status; row.version++; await row.save({ session });
  await recordAudit(session, { bakeryId: row.bakeryId, actorId: context.userId, action: 'billing.attach', entityId: row._id, fromVersion: before, toVersion: row.version, fields: ['phase', 'providerSubscriptionId'] }); return row;
 }, { recovery: true });
}
async function start(context, input) {
 const config = provider.configuration(); await ready(); const hash = sourceChecksum({ ...input, actorId: actorKey(context) });
 const existing = async session => { const row = await Checkout.findOne({ bakeryId: context.bakeryId, operationKey: input.idempotencyKey }).select(SELECT).session(session); if (row && row.requestHash !== hash) throw new ApiError(409, 'This checkout key was used for other details', { code: 'BILLING_KEY_CONFLICT' }); return row; };
 const old = await ownerWrite(context, existing, { recovery: true }); if (old) return { checkout: view(old), replayed: true };
 const quote = await provider.plan(input.planId);
 const result = await ownerWrite(context, async (session, bakery) => {
  const previous = await existing(session); if (previous) return { row: previous, claimed: false };
  const current = await Checkout.findOne({ bakeryId: bakery._id, current: true }).session(session);
  if (current) {
   if (!TERMINAL.includes(current.providerStatus) || (current.paidThrough && current.paidThrough > new Date()) || current.phase === 'creating') throw new ApiError(409, 'Resolve or finish the existing subscription before creating another', { code: 'BILLING_REJECTED' });
   current.current = false; current.version++; await current.save({ session });
  }
  if (input.expectedAmountPaise !== quote.amountPaise) throw new ApiError(409, 'Test plan price changed. Review the plan again', { code: 'BILLING_REJECTED' });
  const [row] = await Checkout.create([{ bakeryId: bakery._id, actorId: context.userId, planId: input.planId, providerPlanId: quote.providerPlanId, amountPaise: quote.amountPaise, keyId: config.keyId, accountId: config.accountId, operationKey: input.idempotencyKey, requestHash: hash }], { session });
  bakery.billingCheckoutId = row._id;
  await entitlement(session, bakery, row, { planId: row.planId, status: 'cancelled', trialEndsAt: null, currentPeriodEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false }, 'Razorpay test checkout awaiting verified payment');
  await bakery.save({ session }); await recordAudit(session, { bakeryId: bakery._id, actorId: context.userId, action: 'billing.checkout', entityId: row._id, fromVersion: 0, toVersion: 1, fields: ['planId', 'amountPaise'] });
  return { row, claimed: true };
 }, { recovery: true });
 if (!result.claimed) return { checkout: view(result.row), replayed: true };
 try {
  const sub = await provider.request('POST', 'subscriptions', { plan_id: result.row.providerPlanId, total_count: 12, quantity: 1, customer_notify: false, expire_by: Math.floor(Date.now() / 1000) + 3600, notes: { saas_checkout: String(result.row._id), saas_bakery: String(context.bakeryId), saas_mode: 'test' } });
  return { checkout: view(await attach(context, result.row._id, sub)), replayed: false };
 } catch { throw new ApiError(503, 'Checkout creation was not confirmed. Retry the same request or recover it using the test dashboard subscription ID; do not create another subscription', { code: 'BILLING_CHECKOUT_UNCERTAIN' }); }
}
const date = seconds => Number.isSafeInteger(seconds) && seconds > 0 && seconds < 4102444800 ? new Date(seconds * 1000) : null;
async function snapshot(row) {
 integration(row); const sub = await provider.request('GET', `subscriptions/${provider.idOf(row.providerSubscriptionId, 'sub')}`); validateSubscription(row, sub);
 if (TERMINAL.includes(row.providerStatus) && !TERMINAL.includes(sub.status)) throw ApiError.conflict('A terminal provider subscription cannot be revived');
 const response = await provider.request('GET', `invoices?subscription_id=${sub.id}&count=100&skip=0`);
 if (!Array.isArray(response.items) || response.items.length >= 100) throw ApiError.conflict('Invoice history requires billing reconciliation');
 const invoices = response.items.map(item => {
  if (item.subscription_id !== sub.id || !/^inv_[a-zA-Z0-9]+$/.test(item.id || '') || item.currency !== 'INR' || !['draft', 'issued', 'paid', 'cancelled', 'expired', 'partially_paid'].includes(item.status) || [item.amount, item.amount_paid, item.amount_due].some(n => !Number.isSafeInteger(n) || n < 0 || n > 1000000000000)) throw ApiError.conflict('Provider invoice does not match this subscription');
  return { providerInvoiceId: item.id, status: item.status, amountPaise: item.amount, paidPaise: item.amount_paid, duePaise: item.amount_due, billingStart: date(item.billing_start), billingEnd: date(item.billing_end), hostedUrl: provider.safeLink(item.short_url), paymentId: item.payment_id };
 });
 const paid = invoices.filter(item => item.status === 'paid' && item.duePaise === 0 && item.paidPaise === item.amountPaise && item.amountPaise >= row.amountPaise && item.billingStart && item.billingEnd && item.billingEnd > item.billingStart && item.billingEnd - item.billingStart <= 45 * 86400000 && item.billingEnd.getTime() <= Date.now() + 45 * 86400000).sort((a, b) => b.billingEnd - a.billingEnd)[0];
 let paidThrough = null;
 if (paid) {
  const payment = await provider.request('GET', `payments/${provider.idOf(paid.paymentId, 'pay')}`);
  if (payment.id === paid.paymentId && payment.invoice_id === paid.providerInvoiceId && payment.currency === 'INR' && payment.status === 'captured' && payment.captured === true && payment.amount_refunded === 0 && Number.isSafeInteger(payment.amount) && payment.amount >= paid.amountPaise) paidThrough = paid.billingEnd;
 }
 return { sub, invoices, paidThrough };
}
async function synchronize(checkoutId, context) {
 provider.configuration(); await ready(); const row = await Checkout.findOne({ _id: checkoutId, ...(context ? { bakeryId: context.bakeryId } : {}) }).select(SELECT);
 if (!row || row.phase !== 'ready') throw ApiError.conflict('Recover the provider subscription before synchronizing');
 const pendingEvents = await Event.find({ checkoutId: row._id, processedAt: null }).select('_id').limit(1000).lean();
 const eventIds = pendingEvents.map(event => event._id);
 if (!row.current) { const skip = async session => { await Event.updateMany({ _id: { $in: eventIds }, checkoutId: row._id, processedAt: null }, { $set: { processedAt: new Date() } }, { session }); return { skipped: true }; }; return context ? ownerWrite(context, skip, { recovery: true }) : platformWrite(row.bakeryId, skip); }
 const observed = await snapshot(row);
 const apply = async (session, bakery) => {
  const current = await Checkout.findOne({ _id: row._id, bakeryId: bakery._id, current: true }).select(SELECT).session(session);
  if (!current || String(bakery.billingCheckoutId) !== String(row._id)) { await Event.updateMany({ _id: { $in: eventIds }, checkoutId: row._id, processedAt: null }, { $set: { processedAt: new Date() } }, { session }); return { skipped: true }; }
  if (current.version !== row.version) throw ApiError.conflict('Billing changed during synchronization. Refresh again');
  current.providerStatus = observed.sub.status; current.paidThrough = observed.paidThrough; current.synchronizedAt = new Date(); current.version++; await current.save({ session });
  for (const invoice of observed.invoices) { const { paymentId: ignored, ...safe } = invoice; await Invoice.findOneAndUpdate({ bakeryId: bakery._id, providerInvoiceId: safe.providerInvoiceId }, { $set: safe, $setOnInsert: { bakeryId: bakery._id, checkoutId: row._id } }, { upsert: true, runValidators: true, session }); }
  let status = 'cancelled', graceEndsAt = null, cancelAtPeriodEnd = false;
  if (observed.paidThrough) {
   if (['pending', 'halted'].includes(current.providerStatus) && current.cancelState !== 'confirmed') { status = 'past_due'; graceEndsAt = new Date(observed.paidThrough.getTime() + 7 * 86400000); }
   else { status = 'active'; cancelAtPeriodEnd = current.cancelState === 'confirmed' || [...TERMINAL, 'paused'].includes(current.providerStatus); }
  }
  await entitlement(session, bakery, current, { planId: current.planId, status, trialEndsAt: null, currentPeriodEndsAt: observed.paidThrough, graceEndsAt, cancelAtPeriodEnd }, 'Razorpay test subscription reconciled against fetched invoice/payment records');
  await Event.updateMany({ _id: { $in: eventIds }, checkoutId: row._id, processedAt: null }, { $set: { processedAt: new Date() } }, { session });
  await recordAudit(session, { bakeryId: bakery._id, actorId: current.actorId, actorType: 'platform', action: 'billing.sync', entityId: row._id, fromVersion: row.version, toVersion: current.version, fields: ['providerStatus', 'paidThrough'] }); return { checkout: view(current) };
 };
 return context ? ownerWrite(context, apply, { recovery: true }) : platformWrite(row.bakeryId, apply);
}
async function cancel(context, expectedVersion) {
 const result = await ownerWrite(context, async session => {
  const row = await Checkout.findOne({ bakeryId: context.bakeryId, current: true }).select(SELECT).session(session);
  if (!row || row.phase !== 'ready') throw ApiError.conflict('No provider subscription is ready for cancellation'); integration(row);
  if (row.cancelState === 'confirmed' || TERMINAL.includes(row.providerStatus)) return { row, call: false };
  if (row.version !== expectedVersion) throw ApiError.conflict('Billing changed. Refresh before cancellation');
  if (row.cancelState === 'pending' && row.cancelAttemptAt > new Date(Date.now() - 30000)) throw ApiError.conflict('Cancellation is still pending. Refresh before retrying');
  const before = row.version; row.cancelState = 'pending'; row.cancelAttemptAt = new Date(); row.version++; await row.save({ session });
  await recordAudit(session, { bakeryId: row.bakeryId, actorId: context.userId, action: 'billing.cancel', entityId: row._id, fromVersion: before, toVersion: row.version, fields: ['cancelState', 'cancelAttemptAt'] }); return { row, call: true };
 }, { recovery: true });
 if (!result.call) return { checkout: view(result.row), replayed: true };
 try { const sub = await provider.request('POST', `subscriptions/${provider.idOf(result.row.providerSubscriptionId, 'sub')}/cancel`, { cancel_at_cycle_end: true }); validateSubscription(result.row, sub); }
 catch { await ownerWrite(context, async session => { await Checkout.updateOne({ _id: result.row._id, version: result.row.version }, { $set: { cancelState: 'uncertain' }, $inc: { version: 1 } }, { session }); }, { recovery: true }); throw new ApiError(503, 'Test cancellation was not confirmed. Refresh before retrying', { code: 'BILLING_CANCEL_UNCERTAIN' }); }
 await ownerWrite(context, async session => {
  const row = await Checkout.findOne({ _id: result.row._id, bakeryId: context.bakeryId }).session(session);
  if (row.version !== result.row.version) throw ApiError.conflict('Cancellation may be saved by the provider. Refresh before retrying');
  row.cancelState = 'confirmed'; row.version++; await row.save({ session }); await recordAudit(session, { bakeryId: row.bakeryId, actorId: context.userId, action: 'billing.cancel', entityId: row._id, fromVersion: result.row.version, toVersion: row.version, fields: ['cancelState'] });
 }, { recovery: true });
 return synchronize(result.row._id, context);
}
async function ingest(raw, signature, eventId) {
 const payload = provider.verify(raw, signature);
 if (typeof eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(eventId)) throw ApiError.badRequest('A billing event ID is required');
 if (typeof payload.event !== 'string' || !payload.event.startsWith('subscription.')) return { ignored: true };
 const sub = payload.payload?.subscription?.entity;
 const subscriptionId = provider.idOf(sub?.id, 'sub');
 const row = await Checkout.findOne({ providerSubscriptionId: subscriptionId }).select(SELECT);
 // Early/unlinked events grant nothing; an explicit recovery + status refresh
 // fetches authoritative state, so unknown event metadata never links tenants.
 if (!row) return { ignored: true }; integration(row); await ready(); const hash = require('node:crypto').createHash('sha256').update(raw).digest('hex');
 const old = await Event.findOne({ eventId }).select('+payloadHash').lean();
 if (old) { if (old.payloadHash !== hash || String(old.checkoutId) !== String(row._id)) throw ApiError.conflict('Billing event ID was reused'); return { replayed: true }; }
 try { await Event.create({ bakeryId: row.bakeryId, checkoutId: row._id, eventId, payloadHash: hash, eventType: payload.event.slice(0,100), providerSubscriptionId: sub.id }); }
 catch (error) { if (error.code !== 11000) throw error; const previous = await Event.findOne({ eventId }).select('+payloadHash').lean(); if (!previous || previous.payloadHash !== hash) throw ApiError.conflict('Billing event ID was reused'); }
 return { queued: true };
}
module.exports = { ready, view, start, attach, synchronize, cancel, ingest };
