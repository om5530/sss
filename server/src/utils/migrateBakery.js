// Non-destructive, repeatable migration. Default is a read-only preview.
require("dotenv").config();
const mongoose = require("mongoose");
const M = require("../models/BakeryMaterial");
const R = require("../models/BakeryRecipe");
const Legacy = require("../models/BakeryProduction");
const O = require("../models/BakeryOperations");
const E = require("../services/bakeryCost.service");
async function migrate(commit = false) {
  const materials = await M.find().lean(),
    recipes = await R.find().lean(),
    sheets = await Legacy.find().lean();
  const preview = {
    materials: materials.length,
    recipes: recipes.length,
    legacySheets: sheets.length,
    commit,
  };
  if (!commit) return preview;
  await mongoose.connection.transaction(async (session) => {
    for (const m of materials) {
      const key = `bakery-v2:material:${m._id}`;
      if (await O.Migration.exists({ key }).session(session)) continue;
      const doc = await M.findById(m._id).session(session);
      // Do not infer mass/volume density from the old schema's default 1.0.
      if (doc.densityGramPerMl === 1) doc.densityGramPerMl = null;
      if (!doc.preferredFormatId) {
        const [supplier] = await O.Supplier.create(
          [{ name: m.supplierName || "Legacy purchase" }],
          { session },
        );
        const [format] = await O.Format.create(
          [
            {
              materialId: m._id,
              supplierId: supplier._id,
              packQuantity: String(m.packQuantity),
              packUom: m.packUom,
              brand: m.brand,
              leadTimeDays: m.leadTimeDays,
            },
          ],
          { session },
        );
        await O.Price.create(
          [
            {
              materialId: m._id,
              supplierId: supplier._id,
              formatId: format._id,
              packQuantity: String(m.packQuantity),
              packUom: m.packUom,
              purchasePrice: String(m.purchasePrice),
              unitCost: E.rate(doc),
              effectiveAt: m.updatedAt || new Date(),
            },
          ],
          { session },
        );
        doc.preferredFormatId = format._id;
      }
      await doc.save({ session });
      if (!(await O.Movement.exists({ materialId: m._id }).session(session)))
        await O.Movement.create(
          [
            {
              materialId: m._id,
              quantity: String(m.currentStock),
              balance: String(m.currentStock),
              type: "opening",
              reference: key,
              notes:
                "Opening balance from pre-ledger stock; earlier movements unavailable",
            },
          ],
          { session },
        );
      await O.Migration.create(
        [
          {
            key,
            notes:
              "Material preserved; decimal storage, initial price and opening ledger added",
          },
        ],
        { session },
      );
    }
    for (const r of recipes)
      await O.Revision.updateOne(
        { recipeId: r._id, version: r.version || 1 },
        { $setOnInsert: { recipe: r } },
        { upsert: true, session },
      );
    for (const s of sheets) {
      const code = `LEGACY-${s._id}`;
      if (await O.Sheet.exists({ code }).session(session)) continue;
      await O.Sheet.create(
        [
          {
            code,
            type:
              s.type === "production_plan"
                ? "production_plan"
                : "costing_sheet",
            referenceName: s.referenceName,
            customerName: s.customerName,
            notes: s.notes,
            items: s.items,
            status: "draft",
            snapshot: {
              legacy: true,
              warning:
                "Imported historical totals. Original material and recipe assumptions may be incomplete; create a new plan before production.",
              totalCost: String(s.totalCost),
              suggestedSellingPrice: String(s.suggestedSellingPrice),
              markupPercent: String(s.markupPercent),
              requirements: [
                ...s.aggregatedIngredients,
                ...s.aggregatedPackaging,
              ],
              products: [],
              original: s,
            },
          },
        ],
        { session },
      );
    }
    await O.Migration.updateOne(
      { key: "bakery-v2" },
      { $set: { notes: "Non-destructive migration complete" } },
      { upsert: true, session },
    );
  });
  return preview;
}
if (require.main === module)
  (async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw Error("MONGODB_URI is required");
    const commit = process.argv.includes("--apply");
    await mongoose.connect(uri, { autoIndex: commit, autoCreate: commit });
    if (commit) for (const m of Object.values(O)) await m.init();
    console.log(await migrate(commit));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
    mongoose.disconnect();
  });
module.exports = { migrate };
