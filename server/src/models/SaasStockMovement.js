const mongoose = require('mongoose');
const quantity = { type: Number, min: 0, max: 1000000, validate: value => value === null || Number.isSafeInteger(value), immutable: true };
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  productId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorType: { type: String, enum: ['staff', 'customer'], immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, select: false },
  wasteId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  productionRunId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  kind: { type: String, enum: ['opening', 'adjustment', 'tracking', 'sale', 'production', 'waste', 'reservation_return'], required: true, immutable: true },
  before: quantity, after: quantity,
  delta: { type: Number, validate: value => value === null || Number.isSafeInteger(value), immutable: true },
  productVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
}, { collection: 'saas_stock_movements', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, productId: 1, productVersion: 1 }, { unique: true });
schema.index({ bakeryId: 1, productId: 1, _id: -1 });
module.exports = mongoose.model('SaasStockMovement', schema);
