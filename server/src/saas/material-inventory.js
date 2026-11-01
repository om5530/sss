const { createHash } = require('node:crypto');
const Stock = require('../models/SaasMaterialStock');
const Movement = require('../models/SaasMaterialMovement');
const { Decimal, convertUnits } = require('../services/bakeryCost.service');
const { requireCapacity } = require('./usage-limits');
const ApiError = require('../utils/ApiError');
const BASE = Object.freeze({ mg: 'g', g: 'g', kg: 'g', ml: 'ml', L: 'ml', piece: 'piece', dozen: 'piece', packet: 'packet', box: 'box' });
async function inventoryReady() { await Promise.all([Stock.init(), Movement.init()]); }
async function checkMaterialChange(bakeryId, material, changes, session) {
  const stock = await Stock.findOne({ bakeryId, materialId: material._id }).session(session).lean();
  if (!stock) return;
  if (!['ingredient', 'packaging'].includes(changes.type ?? material.type) || BASE[changes.packUom ?? material.packUom] !== stock.unit) throw ApiError.conflict('Tracked inventory requires a physical material with the same unit dimension');
}
async function productionInventory(bakeryId, ingredients, session) {
  const stocks = await Stock.find({ bakeryId, materialId: { $in: ingredients.map(row => row.materialId) } }).session(session).lean();
  const byId = new Map(stocks.map(row => [String(row.materialId), row])), combined = new Map();
  for (const row of ingredients) {
    const id = String(row.materialId), stock = byId.get(id); if (!stock) continue;
    let required;
    try { required = new Decimal(convertUnits(row.quantity, row.uom, stock.unit)); }
    catch { throw ApiError.conflict('A tracked material unit conflicts with this saved revision. Review its mapping'); }
    const previous = combined.get(id);
    combined.set(id, { stock, name: row.name, required: (previous?.required || new Decimal(0)).add(required), cost: (previous?.cost || new Decimal(0)).add(row.costPaise) });
  }
  const usage = [...combined.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([materialId, row]) => {
    const after = new Decimal(row.stock.onHand).sub(row.required);
    if (after.lt(0)) throw ApiError.conflict(`Insufficient material stock for ${row.name}`);
    return { materialId, materialName: row.name, unit: row.stock.unit, quantity: row.required.toString(), before: row.stock.onHand,
      after: after.toString(), stockVersion: row.stock.version, estimatedCostPaise: row.cost.toString() };
  });
  const fingerprint = createHash('sha256').update(JSON.stringify(usage)).digest('hex');
  return { usage, fingerprint };
}
async function consumeProduction(session, context, runId, usage) {
  for (const line of usage) {
    await requireCapacity(Movement, context.bakeryId, 'materialMovements', session);
    const stock = await Stock.findOneAndUpdate({ bakeryId: context.bakeryId, materialId: line.materialId, version: line.stockVersion },
      { $set: { onHand: line.after }, $inc: { version: 1 } }, { session, new: true, runValidators: true });
    if (!stock) throw ApiError.conflict('Material inventory changed. Review production again');
    await Movement.create([{ ...line, bakeryId: context.bakeryId, actorId: context.userId, kind: 'production', productionRunId: runId,
      stockVersion: stock.version, operationKey: `production:${runId}:${line.materialId}`, reason: '' }], { session });
  }
}
module.exports = { BASE, Stock, Movement, inventoryReady, checkMaterialChange, productionInventory, consumeProduction };
