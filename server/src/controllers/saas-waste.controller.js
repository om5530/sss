const { actorKey } = require('../saas/account-access');
const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const Waste = require('../models/SaasWaste');
const Product = require('../models/SaasProduct');
const Revision = require('../models/SaasRecipeRevision');
const Event = require('../models/SaasEvent');
const { Decimal } = require('../services/bakeryCost.service');
const { fields, integer, text } = require('../saas/recipe-input');
const { ownerWrite } = require('../saas/owner-write');
const { recordMovement, stockReady } = require('../saas/stock-movement');
const { auditReady, recordAudit } = require('../saas/audit');
const { requireCapacity } = require('../saas/usage-limits');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const oid = /^[a-f0-9]{24}$/i;
const view = row => Object.fromEntries(['_id', 'productId', 'productName', 'eventId', 'eventName', 'quantity', 'stockBefore', 'stockAfter', 'productVersion', 'revisionId', 'revisionNumber', 'batchCostPaise', 'yieldPieces', 'estimatedCostPaise', 'reason', 'createdAt'].map(key => [key, row[key]]));
function inputOf(body, saving = false) {
  fields(body, ['productId', 'eventId', 'quantity', 'expectedProductVersion', 'reason', ...(saving ? ['confirmed', 'idempotencyKey'] : [])]);
  if (typeof body.productId !== 'string' || !oid.test(body.productId)) throw ApiError.badRequest('Invalid product');
  const eventId = body.eventId ?? null;
  if (eventId !== null && (typeof eventId !== 'string' || !oid.test(eventId))) throw ApiError.badRequest('Invalid event');
  const input = { productId: body.productId.toLowerCase(), eventId: eventId?.toLowerCase() ?? null,
    quantity: integer(body.quantity, 'quantity'), expectedProductVersion: integer(body.expectedProductVersion, 'expectedProductVersion', 1, Number.MAX_SAFE_INTEGER), reason: text(body.reason, 'reason', 500) };
  if (saving) {
    if (body.confirmed !== true) throw ApiError.badRequest('Confirm the finished-product wastage');
    if (typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 wastage key is required');
    input.idempotencyKey = body.idempotencyKey.toLowerCase();
  }
  return input;
}
async function prepare(bakeryId, input, session) {
  const product = await Product.findOne({ _id: input.productId, bakeryId }).session(session);
  if (!product) throw ApiError.notFound('Product not found');
  if (product.version !== input.expectedProductVersion) throw ApiError.conflict('Product changed. Refresh and review the wastage');
  if (product.stockCount === null) throw ApiError.conflict('Wastage requires tracked product stock');
  if (product.stockCount < input.quantity) throw ApiError.conflict('Insufficient product stock');
  const event = input.eventId ? await Event.findOne({ _id: input.eventId, bakeryId }).session(session).lean() : null;
  if (input.eventId && !event) throw ApiError.notFound('Event not found');
  let revision = null;
  if (product.recipeRevisionId) {
    revision = await Revision.findOne({ _id: product.recipeRevisionId, recipeId: product.recipeId, bakeryId }).session(session).lean();
    if (!revision) throw ApiError.conflict('Repair the product recipe mapping before recording wastage');
  }
  return { product, snapshot: { productId: product._id, productName: product.name, eventId: event?._id || null, eventName: event?.name || '', quantity: input.quantity,
    stockBefore: product.stockCount, stockAfter: product.stockCount - input.quantity, productVersion: product.version + 1,
    revisionId: revision?._id || null, revisionNumber: revision?.revisionNumber || null, batchCostPaise: revision?.batchCostPaise ?? null, yieldPieces: revision?.yieldPieces || null,
    estimatedCostPaise: revision ? new Decimal(revision.batchCostPaise).mul(input.quantity).div(revision.yieldPieces).toString() : null, reason: input.reason } };
}
const quote = asyncHandler(async (req, res) => {
  const input = inputOf(req.body), session = await mongoose.startSession(); let snapshot;
  try { await session.withTransaction(async () => { snapshot = (await prepare(req.bakeryContext.bakeryId, input, session)).snapshot; }, { readConcern: { level: 'snapshot' } }); }
  finally { await session.endSession(); }
  res.json({ success: true, quote: snapshot });
});
const create = asyncHandler(async (req, res) => {
  const input = inputOf(req.body, true), hash = createHash('sha256').update(JSON.stringify({ ...input, actorId: actorKey({ userId: req.user._id, identityType: req.identityType }) })).digest('hex');
  await Promise.all([Waste.init(), stockReady(), auditReady()]);
  const result = await ownerWrite(req.bakeryContext, async session => {
    const bakeryId = req.bakeryContext.bakeryId, previous = await Waste.findOne({ bakeryId, idempotencyKey: input.idempotencyKey }).select('+requestHash').session(session);
    if (previous) {
      if (previous.requestHash !== hash) throw new ApiError(409, 'This wastage key was used for different details', { code: 'WASTE_KEY_CONFLICT' });
      return { entry: previous, replayed: true };
    }
    try {
      await requireCapacity(Waste, bakeryId, 'wasteEntries', session);
      const { product, snapshot } = await prepare(bakeryId, input, session);
      const [entry] = await Waste.create([{ bakeryId, actorId: req.user._id, ...snapshot, idempotencyKey: input.idempotencyKey, requestHash: hash }], { session });
      product.stockCount = snapshot.stockAfter; product.version++; await product.save({ session });
      await recordMovement(session, req.bakeryContext, { productId: product._id, wasteId: entry._id, kind: 'waste', before: snapshot.stockBefore, after: snapshot.stockAfter, productVersion: product.version });
      await recordAudit(session, { bakeryId, actorId: req.user._id, action: 'waste.record', entityId: entry._id, fromVersion: 0, toVersion: 1, fields: ['productId', 'eventId', 'quantity', 'stockCount'] });
      return { entry, replayed: false };
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) error.details = { code: 'WASTE_REJECTED' };
      throw error;
    }
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, entry: view(result.entry), replayed: result.replayed });
});
const list = asyncHandler(async (req, res) => {
  fields(req.query, ['limit', 'cursor', 'eventId']); const { limit = '20', cursor, eventId } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100 || (cursor !== undefined && (typeof cursor !== 'string' || !oid.test(cursor)))
    || (eventId !== undefined && (typeof eventId !== 'string' || !oid.test(eventId)))) throw ApiError.badRequest('Invalid wastage pagination');
  const rows = await Waste.find({ bakeryId: req.bakeryContext.bakeryId, ...(eventId ? { eventId } : {}), ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = rows.length > +limit; if (more) rows.pop(); res.json({ success: true, entries: rows.map(view), nextCursor: more ? String(rows.at(-1)._id) : null });
});
module.exports = { quote, create, list };
