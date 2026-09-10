const mongoose = require("mongoose");
const { Schema } = mongoose;
const ref = { type: Schema.Types.ObjectId, required: true };
const model = (name, fields, indexes = []) => {
  const schema = new Schema(fields, {
    timestamps: true,
    optimisticConcurrency: true,
  });
  for (const [keys, opts] of indexes) schema.index(keys, opts);
  return mongoose.models[name] || mongoose.model(name, schema);
};
exports.Supplier = model("BakerySupplier", {
  name: { type: String, required: true, trim: true },
  contact: String,
  notes: String,
  active: { type: Boolean, default: true },
});
exports.Format = model("BakeryPurchaseFormat", {
  materialId: ref,
  supplierId: ref,
  supplierCode: String,
  brand: String,
  packQuantity: String,
  packUom: String,
  minimumOrderPacks: { type: String, default: "1" },
  leadTimeDays: { type: Number, default: 0 },
  lastPurchasedAt: Date,
});
exports.Price = model(
  "BakeryPrice",
  {
    formatId: ref,
    materialId: ref,
    supplierId: ref,
    packQuantity: String,
    packUom: String,
    purchasePrice: String,
    unitCost: String,
    effectiveAt: { type: Date, required: true },
  },
  [[{ formatId: 1, effectiveAt: -1 }, {}]],
);
exports.Revision = model(
  "BakeryRevision",
  { recipeId: ref, version: Number, recipe: Schema.Types.Mixed },
  [[{ recipeId: 1, version: 1 }, { unique: true }]],
);
exports.Sheet = model("BakerySheet", {
  code: { type: String, required: true, unique: true },
  type: {
    type: String,
    enum: ["costing_sheet", "production_plan"],
    required: true,
  },
  referenceName: String,
  customerName: String,
  requiredDate: Date,
  notes: String,
  items: [Schema.Types.Mixed],
  snapshot: Schema.Types.Mixed,
  status: {
    type: String,
    enum: ["draft", "scheduled", "completed", "cancelled"],
    default: "draft",
  },
  actual: Schema.Types.Mixed,
  completedAt: Date,
  operationKey: String,
});
exports.Movement = model("BakeryMovement", {
  materialId: ref,
  quantity: String,
  balance: String,
  type: {
    type: String,
    enum: [
      "opening",
      "receipt",
      "consumption",
      "waste",
      "adjustment",
      "return",
    ],
    required: true,
  },
  reference: String,
  notes: String,
  actorId: Schema.Types.ObjectId,
});
exports.Purchase = model("BakeryPurchase", {
  code: { type: String, required: true, unique: true },
  supplierId: ref,
  status: {
    type: String,
    enum: ["draft", "ordered", "partially_received", "received", "cancelled"],
    default: "draft",
  },
  lines: [Schema.Types.Mixed],
  notes: String,
});
exports.Receipt = model("BakeryReceipt", {
  purchaseId: ref,
  operationKey: { type: String, required: true, unique: true },
  lines: [Schema.Types.Mixed],
  receivedAt: Date,
});
exports.Migration = model("BakeryMigration", {
  key: { type: String, required: true, unique: true },
  notes: String,
});
