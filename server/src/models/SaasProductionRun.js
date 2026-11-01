const mongoose = require('mongoose');
const ingredient = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true },
  quantity: { type: String, required: true }, uom: { type: String, required: true }, costPaise: { type: String, required: true },
}, { _id: false, strict: 'throw' });
const usage = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true }, materialName: { type: String, required: true },
  unit: { type: String, required: true }, quantity: { type: String, required: true }, before: { type: String, required: true }, after: { type: String, required: true },
  stockVersion: { type: Number, required: true }, estimatedCostPaise: { type: String, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  revisionId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, select: false },
  productName: { type: String, required: true, immutable: true }, recipeName: { type: String, required: true, immutable: true },
  revisionNumber: { type: Number, required: true, immutable: true }, yieldPieces: { type: Number, required: true, immutable: true },
  batches: { type: Number, required: true, min: 1, max: 1000, immutable: true }, producedPieces: { type: Number, required: true, min: 1, max: 1000000, immutable: true },
  stockBefore: { type: Number, required: true, immutable: true }, stockAfter: { type: Number, required: true, immutable: true }, productVersion: { type: Number, required: true, immutable: true },
  batchCostPaise: { type: String, required: true, immutable: true }, totalCostPaise: { type: String, required: true, immutable: true },
  overheadPaise: { type: String, required: true, immutable: true }, ingredients: { type: [ingredient], default: undefined, required: true, immutable: true },
  materialUsage: { type: [usage], default: undefined, immutable: true },
  inventoryFingerprint: { type: String, immutable: true },
  note: { type: String, maxlength: 1000, immutable: true },
  idempotencyKey: { type: String, required: true, immutable: true, select: false }, requestHash: { type: String, required: true, immutable: true, select: false },
}, { collection: 'saas_production_runs', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, _id: -1 });
module.exports = mongoose.model('SaasProductionRun', schema);
