const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  tokenHash: { type: String, required: true, immutable: true, select: false },
  sessionVersion: { type: Number, required: true, immutable: true }, expiresAt: { type: Date, required: true, immutable: true },
}, { collection: 'saas_customer_sessions', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ bakeryId: 1, customerId: 1, createdAt: -1 });
module.exports = mongoose.model('SaasCustomerSession', schema);
