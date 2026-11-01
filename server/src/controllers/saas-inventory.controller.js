const { actorKey } = require('../saas/account-access');
const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const Material = require('../models/SaasMaterial');
const { BASE, Stock, Movement, inventoryReady } = require('../saas/material-inventory');
const { fields, integer, text } = require('../saas/recipe-input');
const { Decimal, convertUnits } = require('../services/bakeryCost.service');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const { requireCapacity } = require('../saas/usage-limits');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const oid = /^[a-f0-9]{24}$/i;
const view = row => Object.fromEntries(['_id', 'materialId', 'kind', 'materialName', 'materialVersion', 'unit', 'quantity', 'before', 'after', 'estimatedCostPaise', 'stockVersion', 'reason', 'productionRunId', 'createdAt'].map(key => [key, row[key]]));
function inputOf(body, saving = false) {
  fields(body, ['materialId', 'kind', 'quantity', 'uom', 'expectedMaterialVersion', 'expectedStockVersion', 'reason', ...(saving ? ['confirmed', 'idempotencyKey'] : [])]);
  if (typeof body.materialId !== 'string' || !oid.test(body.materialId)) throw ApiError.badRequest('Invalid material');
  if (!['opening', 'receipt', 'waste', 'count'].includes(body.kind)) throw ApiError.badRequest('Invalid inventory operation');
  if (typeof body.quantity !== 'string' || !/^\d{1,10}(?:\.\d{1,6})?$/.test(body.quantity)) throw ApiError.badRequest('Use a decimal quantity with up to six decimal places');
  const quantity = new Decimal(body.quantity);
  if (quantity.gt('1000000000') || quantity.lt(0) || (!['opening', 'count'].includes(body.kind) && quantity.isZero())) throw ApiError.badRequest('Invalid inventory quantity');
  if (typeof body.uom !== 'string' || !Object.hasOwn(BASE, body.uom)) throw ApiError.badRequest('Use a supported physical unit');
  const input = { materialId: body.materialId.toLowerCase(), kind: body.kind, quantity: quantity.toString(), uom: body.uom,
    expectedMaterialVersion: integer(body.expectedMaterialVersion, 'expectedMaterialVersion', 1, Number.MAX_SAFE_INTEGER),
    expectedStockVersion: integer(body.expectedStockVersion, 'expectedStockVersion', 0, Number.MAX_SAFE_INTEGER), reason: text(body.reason, 'reason', 500) };
  if (saving) {
    if (body.confirmed !== true) throw ApiError.badRequest('Confirm the material movement');
    if (typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 inventory key is required');
    input.idempotencyKey = body.idempotencyKey.toLowerCase();
  }
  return input;
}
async function prepare(bakeryId, input, session) {
  const material = await Material.findOne({ _id: input.materialId, bakeryId }).session(session).lean();
  if (!material) throw ApiError.notFound('Material not found');
  if (material.version !== input.expectedMaterialVersion) throw ApiError.conflict('Material pricing changed. Refresh and review the movement');
  if (!['ingredient', 'packaging'].includes(material.type) || !BASE[material.packUom]) throw ApiError.conflict('Inventory tracking is for physical ingredients and packaging');
  if (!material.active && !['waste', 'count'].includes(input.kind)) throw ApiError.conflict('Restore this material before recording stock');
  const stock = await Stock.findOne({ bakeryId, materialId: material._id }).session(session);
  if (input.kind === 'opening' ? !!stock || input.expectedStockVersion !== 0 : !stock || stock.version !== input.expectedStockVersion) throw ApiError.conflict('Inventory changed. Reload before saving');
  const unit = stock?.unit || BASE[material.packUom];
  if (BASE[input.uom] !== unit || BASE[material.packUom] !== unit) throw ApiError.badRequest('The quantity unit must match this material dimension');
  const quantity = new Decimal(convertUnits(input.quantity, input.uom, unit)), before = stock?.onHand || '0';
  const after = input.kind === 'waste' ? new Decimal(before).sub(quantity) : input.kind === 'count' ? quantity : new Decimal(before).add(quantity);
  if (after.lt(0)) throw ApiError.conflict('Insufficient material stock');
  if (after.gt('1000000000000000')) throw ApiError.badRequest('Material stock exceeds the supported maximum');
  const cost = new Decimal(convertUnits(input.quantity, input.uom, material.packUom)).mul(material.purchasePricePaise).div(material.packQuantity);
  return { stock, snapshot: { materialId: material._id, kind: input.kind, materialName: material.name, materialVersion: material.version,
    unit, quantity: quantity.toString(), before: stock ? before : null, after: after.toString(), estimatedCostPaise: cost.toString(), stockVersion: (stock?.version || 0) + 1, reason: input.reason } };
}
const quote = asyncHandler(async (req, res) => {
  const input = inputOf(req.body), session = await mongoose.startSession(); let snapshot;
  try { await session.withTransaction(async () => { snapshot = (await prepare(req.bakeryContext.bakeryId, input, session)).snapshot; }, { readConcern: { level: 'snapshot' } }); }
  finally { await session.endSession(); }
  res.json({ success: true, quote: snapshot });
});
const create = asyncHandler(async (req, res) => {
  const input = inputOf(req.body, true), hash = createHash('sha256').update(JSON.stringify({ ...input, actorId: actorKey({ userId: req.user._id, identityType: req.identityType }) })).digest('hex');
  await Promise.all([inventoryReady(), auditReady()]);
  const result = await ownerWrite(req.bakeryContext, async session => {
    const bakeryId = req.bakeryContext.bakeryId, operationKey = `manual:${input.idempotencyKey}`;
    const previous = await Movement.findOne({ bakeryId, operationKey }).select('+requestHash').session(session);
    if (previous) {
      if (previous.requestHash !== hash) throw new ApiError(409, 'This inventory key was used for different details', { code: 'INVENTORY_KEY_CONFLICT' });
      return { entry: previous, replayed: true };
    }
    try {
      await requireCapacity(Movement, bakeryId, 'materialMovements', session);
      const { stock, snapshot } = await prepare(bakeryId, input, session);
      if (!stock) await Stock.create([{ bakeryId, materialId: snapshot.materialId, unit: snapshot.unit, onHand: snapshot.after }], { session });
      else { stock.onHand = snapshot.after; stock.version++; await stock.save({ session }); }
      const [entry] = await Movement.create([{ bakeryId, actorId: req.user._id, ...snapshot, operationKey, requestHash: hash }], { session });
      await recordAudit(session, { bakeryId, actorId: req.user._id, action: 'inventory.record', entityId: entry._id, fromVersion: 0, toVersion: 1, fields: ['materialId', 'kind', 'quantity', 'onHand'] });
      return { entry, replayed: false };
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) error.details = { code: 'INVENTORY_REJECTED' };
      throw error;
    }
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, entry: view(result.entry), replayed: result.replayed });
});
function pagination(query) {
  fields(query, ['limit', 'cursor']); const { limit = '30', cursor } = query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !oid.test(cursor)))) throw ApiError.badRequest('Invalid inventory pagination');
  return { limit: +limit, cursor };
}
const list = asyncHandler(async (req, res) => {
  const { limit, cursor } = pagination(req.query), bakeryId = req.bakeryContext.bakeryId;
  const stocks = await Stock.find({ bakeryId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = stocks.length > limit; if (more) stocks.pop();
  const materials = await Material.find({ bakeryId, _id: { $in: stocks.map(row => row.materialId) } }).lean(), byId = new Map(materials.map(row => [String(row._id), row]));
  res.json({ success: true, stocks: stocks.map(row => ({ _id: row._id, materialId: row.materialId, unit: row.unit, onHand: row.onHand, version: row.version,
    name: byId.get(String(row.materialId))?.name || 'Unavailable material', materialVersion: byId.get(String(row.materialId))?.version ?? null })), nextCursor: more ? String(stocks.at(-1)._id) : null });
});
const history = asyncHandler(async (req, res) => {
  const { limit, cursor } = pagination(req.query), bakeryId = req.bakeryContext.bakeryId, materialId = req.params.materialId;
  if (!oid.test(materialId) || !await Material.exists({ _id: materialId, bakeryId })) throw ApiError.notFound('Material not found');
  const rows = await Movement.find({ bakeryId, materialId, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = rows.length > limit; if (more) rows.pop();
  res.json({ success: true, entries: rows.map(view), nextCursor: more ? String(rows.at(-1)._id) : null });
});
module.exports = { quote, create, list, history };
