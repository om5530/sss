const Checkout = require('../models/SaasBillingCheckout');
const Invoice = require('../models/SaasBillingInvoice');
const provider = require('../saas/billing-provider');
const billing = require('../saas/billing');
const { fields, integer } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const status = asyncHandler(async (req, res) => { fields(req.query, []); const row = await Checkout.findOne({ bakeryId: req.bakeryContext.bakeryId, current: true }).select('+hostedUrl').lean(); res.json({ configured: provider.configured(), mode: 'test', checkout: billing.view(row) }); });
const catalog = asyncHandler(async (req, res) => { fields(req.query, []); const plans = await Promise.all(['starter', 'growth'].map(id => provider.plan(id))); res.json({ mode: 'test', plans: plans.map(({ providerPlanId: ignored, ...plan }) => plan) }); });
const start = asyncHandler(async (req, res) => {
 fields(req.body, ['planId', 'expectedAmountPaise', 'idempotencyKey', 'confirmed']);
 if (req.body.confirmed !== true || !['starter', 'growth'].includes(req.body.planId) || typeof req.body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.body.idempotencyKey)) throw ApiError.badRequest('Confirm a reviewed test billing plan and UUID reference');
 const input = { planId: req.body.planId, expectedAmountPaise: integer(req.body.expectedAmountPaise, 'expectedAmountPaise', 1, 100000000), idempotencyKey: req.body.idempotencyKey.toLowerCase() };
 res.json({ success: true, ...await billing.start(req.bakeryContext, input) });
});
const recover = asyncHandler(async (req, res) => {
 fields(req.body, ['checkoutId', 'providerSubscriptionId', 'confirmed']);
 if (req.body.confirmed !== true || typeof req.body.checkoutId !== 'string' || !/^[a-f0-9]{24}$/i.test(req.body.checkoutId)) throw ApiError.badRequest('Confirm the existing checkout recovery');
 const id = provider.idOf(req.body.providerSubscriptionId, 'sub');
 await ownerWrite(req.bakeryContext, async session => { if (!await Checkout.exists({ _id: req.body.checkoutId, bakeryId: req.bakeryContext.bakeryId, current: true }).session(session)) throw ApiError.notFound('Checkout not found'); }, { recovery: true });
 const row = await billing.attach(req.bakeryContext, req.body.checkoutId, await provider.request('GET', `subscriptions/${id}`)); res.json({ success: true, checkout: billing.view(row) });
});
const synchronize = asyncHandler(async (req, res) => {
 fields(req.body, []); const row = await Checkout.findOne({ bakeryId: req.bakeryContext.bakeryId, current: true }).select('_id').lean();
 if (!row) throw ApiError.notFound('Checkout not found'); res.json({ success: true, ...await billing.synchronize(row._id, req.bakeryContext) });
});
const cancel = asyncHandler(async (req, res) => { fields(req.body, ['expectedVersion', 'confirmed']); if (req.body.confirmed !== true) throw ApiError.badRequest('Confirm stopping test subscription renewals'); res.json({ success: true, ...await billing.cancel(req.bakeryContext, integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER)) }); });
const invoices = asyncHandler(async (req, res) => {
 fields(req.query, ['cursor']); const cursor = req.query.cursor; if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor))) throw ApiError.badRequest('Invalid invoice cursor');
 const rows = await Invoice.find({ bakeryId: req.bakeryContext.bakeryId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(21).lean(); const more = rows.length > 20; if (more) rows.pop();
 res.json({ invoices: rows.map(row => Object.fromEntries(['_id', 'providerInvoiceId', 'status', 'amountPaise', 'paidPaise', 'duePaise', 'billingStart', 'billingEnd', 'hostedUrl'].map(key => [key, row[key]]))), nextCursor: more ? String(rows.at(-1)._id) : null });
});
const webhook = asyncHandler(async (req, res) => { fields(req.query, []); res.set('Cache-Control', 'no-store'); res.json({ success: true, ...await billing.ingest(req.body, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id')) }); });
module.exports = { status, catalog, start, recover, synchronize, cancel, invoices, webhook };
