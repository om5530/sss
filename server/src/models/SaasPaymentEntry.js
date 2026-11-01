const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  kind: { type: String, enum: ['receipt', 'refund', 'baseline'], required: true, immutable: true },
  amountPaise: { type: Number, required: true, min: 0, max: 1000000000000, validate: Number.isSafeInteger, immutable: true },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card', null], immutable: true },
  operationKey: { type: String, required: true, immutable: true, select: false },
  requestHash: { type: String, immutable: true, select: false },
  reason: { type: String, maxlength: 500, immutable: true },
}, { collection: 'saas_payment_entries', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, orderId: 1, operationKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, orderId: 1, _id: -1 });
module.exports = mongoose.model('SaasPaymentEntry', schema);
