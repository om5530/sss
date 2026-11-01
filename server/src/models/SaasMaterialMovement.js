const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, select: false },
  productionRunId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  kind: { type: String, enum: ['opening', 'receipt', 'waste', 'count', 'production'], required: true, immutable: true },
  materialName: { type: String, required: true, immutable: true }, materialVersion: { type: Number, immutable: true },
  unit: { type: String, required: true, immutable: true }, quantity: { type: String, required: true, immutable: true },
  before: { type: String, immutable: true }, after: { type: String, required: true, immutable: true },
  estimatedCostPaise: { type: String, required: true, immutable: true }, stockVersion: { type: Number, required: true, immutable: true },
  reason: { type: String, maxlength: 500, immutable: true }, operationKey: { type: String, required: true, immutable: true, select: false },
  requestHash: { type: String, immutable: true, select: false },
}, { collection: 'saas_material_movements', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, operationKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, materialId: 1, _id: -1 });
module.exports = mongoose.model('SaasMaterialMovement', schema);
