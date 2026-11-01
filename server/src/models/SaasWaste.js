const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, immutable: true }, eventName: { type: String, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, select: false },
  productName: { type: String, required: true, immutable: true }, quantity: { type: Number, required: true, immutable: true },
  stockBefore: { type: Number, required: true, immutable: true }, stockAfter: { type: Number, required: true, immutable: true }, productVersion: { type: Number, required: true, immutable: true },
  revisionId: { type: mongoose.Schema.Types.ObjectId, immutable: true }, revisionNumber: { type: Number, immutable: true },
  batchCostPaise: { type: String, immutable: true }, yieldPieces: { type: Number, immutable: true }, estimatedCostPaise: { type: String, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  idempotencyKey: { type: String, required: true, immutable: true, select: false }, requestHash: { type: String, required: true, immutable: true, select: false },
}, { collection: 'saas_waste', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, eventId: 1, _id: -1 });
schema.index({ bakeryId: 1, _id: -1 });
module.exports = mongoose.model('SaasWaste', schema);
