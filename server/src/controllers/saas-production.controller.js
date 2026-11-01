const { actorKey } = require('../saas/account-access');
const { inventoryReady, productionInventory, consumeProduction } = require('../saas/material-inventory');
const mongoose = require('mongoose');
const Run = require('../models/SaasProductionRun');
const Product = require('../models/SaasProduct');
const Recipe = require('../models/SaasRecipe');
const Revision = require('../models/SaasRecipeRevision');
const { Decimal } = require('../services/bakeryCost.service');
const { inputOf, productionHash } = require('../saas/production-input');
const { ownerWrite } = require('../saas/owner-write');
const { requireCapacity } = require('../saas/usage-limits');
const { recordMovement, stockReady } = require('../saas/stock-movement');
const { auditReady, recordAudit } = require('../saas/audit');
const { fields } = require('../saas/recipe-input');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const view = run => Object.fromEntries(['_id', 'productId', 'recipeId', 'revisionId', 'productName', 'recipeName', 'revisionNumber', 'yieldPieces', 'batches', 'producedPieces', 'stockBefore', 'stockAfter', 'productVersion', 'batchCostPaise', 'totalCostPaise', 'overheadPaise', 'ingredients', 'materialUsage', 'inventoryFingerprint', 'note', 'createdAt'].map(key => [key, run[key]]));
async function prepare(bakeryId, input, session) {
  const product = await Product.findOne({ _id: input.productId, bakeryId, archived: false }).session(session);
  if (!product) throw ApiError.notFound('Product not found');
  if (product.version !== input.expectedProductVersion) throw ApiError.conflict('Product changed. Refresh before recording production');
  if (product.stockCount === null) throw ApiError.conflict('Enable product stock tracking before recording production');
  if (!product.recipeRevisionId || String(product.recipeRevisionId) !== input.revisionId) throw ApiError.conflict('The mapped recipe revision changed. Refresh before recording production');
  const recipe = await Recipe.findOne({ _id: product.recipeId, bakeryId, archived: false }).session(session).lean();
  const revision = await Revision.findOne({ _id: input.revisionId, recipeId: product.recipeId, bakeryId }).session(session).lean();
  if (!recipe || !revision) throw ApiError.conflict('Repair this product recipe mapping before recording production');
  const producedPieces = revision.yieldPieces * input.batches, stockAfter = product.stockCount + producedPieces;
  if (!Number.isSafeInteger(producedPieces) || producedPieces > 1000000 || stockAfter > 1000000) throw ApiError.badRequest('Produced pieces or resulting stock exceed the supported maximum');
  const snapshot = { productId: product._id, recipeId: recipe._id, revisionId: revision._id, productName: product.name, recipeName: recipe.name,
    revisionNumber: revision.revisionNumber, yieldPieces: revision.yieldPieces, batches: input.batches, producedPieces,
    stockBefore: product.stockCount, stockAfter, productVersion: product.version + 1, batchCostPaise: revision.batchCostPaise,
    totalCostPaise: new Decimal(revision.batchCostPaise).mul(input.batches).toString(), overheadPaise: new Decimal(revision.overheadPaise).mul(input.batches).toString(),
    ingredients: revision.ingredients.map(row => ({ materialId: row.materialId, name: row.name, uom: row.uom,
      quantity: new Decimal(row.quantity).mul(input.batches).toString(), costPaise: new Decimal(row.costPaise).mul(input.batches).toString() })), note: input.note };
  const inventory = await productionInventory(bakeryId, snapshot.ingredients, session);
  snapshot.materialUsage = inventory.usage; snapshot.inventoryFingerprint = inventory.fingerprint;
  return { product, snapshot };
}
const quote = asyncHandler(async (req, res) => {
  const input = inputOf(req.body); await inventoryReady();
  const session = await mongoose.startSession(); let result;
  try { await session.withTransaction(async () => { result = (await prepare(req.bakeryContext.bakeryId, input, session)).snapshot; }, { readConcern: { level: 'snapshot' } }); }
  finally { await session.endSession(); }
  res.json({ success: true, quote: result });
});
const create = asyncHandler(async (req, res) => {
  const input = inputOf(req.body, true), hash = productionHash(input, actorKey({ userId: req.user._id, identityType: req.identityType }));
  await Promise.all([Run.init(), stockReady(), inventoryReady(), auditReady()]);
  const result = await ownerWrite(req.bakeryContext, async session => {
    const bakeryId = req.bakeryContext.bakeryId;
    const previous = await Run.findOne({ bakeryId, idempotencyKey: input.idempotencyKey }).select('+requestHash').session(session);
    if (previous) {
      if (previous.requestHash !== hash) throw new ApiError(409, 'This production key was already used for different details', { code: 'PRODUCTION_KEY_CONFLICT' });
      return { run: previous, replayed: true };
    }
    try {
      await requireCapacity(Run, bakeryId, 'productionRuns', session);
      const { product, snapshot } = await prepare(bakeryId, input, session);
      if ((snapshot.materialUsage.length || input.inventoryFingerprint) && input.inventoryFingerprint !== snapshot.inventoryFingerprint) throw ApiError.conflict('Material inventory changed. Review production again');
      const [run] = await Run.create([{ bakeryId, actorId: req.user._id, ...snapshot, idempotencyKey: input.idempotencyKey, requestHash: hash }], { session });
      await consumeProduction(session, req.bakeryContext, run._id, snapshot.materialUsage);
      product.stockCount = snapshot.stockAfter; product.version++; await product.save({ session });
      await recordMovement(session, req.bakeryContext, { productId: product._id, productionRunId: run._id, kind: 'production', before: snapshot.stockBefore, after: snapshot.stockAfter, productVersion: product.version });
      await recordAudit(session, { bakeryId, actorId: req.user._id, action: 'production.record', entityId: run._id, fromVersion: 0, toVersion: 1, fields: ['productId', 'revisionId', 'batches', 'stockCount'] });
      return { run, replayed: false };
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) error.details = { code: 'PRODUCTION_REJECTED' };
      throw error;
    }
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, run: view(result.run), replayed: result.replayed });
});
const list = asyncHandler(async (req, res) => {
  fields(req.query, ['limit', 'cursor']); const { limit = '20', cursor } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)))) throw ApiError.badRequest('Invalid production pagination');
  const runs = await Run.find({ bakeryId: req.bakeryContext.bakeryId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = runs.length > +limit; if (more) runs.pop();
  res.json({ success: true, runs: runs.map(view), nextCursor: more ? String(runs.at(-1)._id) : null });
});
module.exports = { quote, create, list };
