const Material = require('../models/BakeryMaterial');
const Recipe = require('../models/BakeryRecipe');
const O = require('../models/BakeryOperations');
const E = require('./bakeryCost.service');

// Use the same effective purchase prices for recipes, product pricing and reports.
async function maps(session, at = new Date(), excludePlanId, includeRecipes = true, includePlans = true) {
  const read = (model, query = {}) => model.find(query).session(session || null).lean();
  const queries = [
    () => read(Material),
    // Only the latest effective price for each format is used in costing.
    // Reduce the history in MongoDB instead of transferring every old price.
    () => O.Price.aggregate([
      { $match: { effectiveAt: { $lte: at } } },
      { $sort: { formatId: 1, effectiveAt: -1, _id: -1 } },
      { $group: { _id: '$formatId', price: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$price' } },
    ]).session(session || null),
    () => read(O.Format), () => read(O.Supplier),
    () => includePlans ? read(O.Sheet, { status: 'scheduled', type: 'production_plan', ...(excludePlanId ? { _id: { $ne: excludePlanId } } : {}) }) : [],
    () => includeRecipes ? read(Recipe) : [],
  ];
  // A transaction session must execute queries sequentially. Independent
  // reads outside a transaction can share the same wait for the database.
  const rows = [];
  if (session) {
    for (const query of queries) rows.push(await query());
  } else {
    rows.push(...await Promise.all(queries.map(query => query())));
  }
  const [materialRows, prices, formatRows, supplierRows, plans, recipeRows] = rows;
  const materials = new Map(materialRows.map((m) => [String(m._id), m]));
  const latest = new Map();
  for (const p of prices) if (!latest.has(String(p.formatId))) latest.set(String(p.formatId), p);
  const formats = new Map(formatRows.map((f) => [String(f._id), f]));
  const suppliers = new Map(supplierRows.map((s) => [String(s._id), s]));
  for (const m of materials.values()) {
    const f = formats.get(String(m.preferredFormatId)), p = f && latest.get(String(f._id));
    if (f && p) Object.assign(m, {
      packQuantity: p.packQuantity, packUom: p.packUom, purchasePrice: p.purchasePrice,
      effectiveUnitCost: E.calculateEffectiveUnitCost(p.packQuantity, p.packUom, p.purchasePrice, m.baseUom, m.densityGramPerMl),
      minimumOrderPacks: f.minimumOrderPacks, supplierName: suppliers.get(String(f.supplierId))?.name || '',
    });
    m.allocatedStock = '0';
  }
  for (const plan of plans) for (const r of plan.snapshot?.requirements || []) {
    const m = materials.get(String(r.materialId));
    if (m && ['ingredient', 'packaging'].includes(m.type)) m.allocatedStock = new E.Decimal(m.allocatedStock).add(r.quantity).toString();
  }
  return { materials, plans, recipes: new Map(recipeRows.map((r) => [String(r._id), r])), latest, formats, suppliers };
}
module.exports = { maps };
