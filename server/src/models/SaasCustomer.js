const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  email: { type: String, required: true, maxlength: 254 }, displayName: { type: String, required: true, maxlength: 120 },
  passwordHash: { type: String, required: true, select: false },
  emailVerified: { type: Boolean, default: false, required: true }, active: { type: Boolean, default: true, required: true },
  emailPreviewConfirmedAt: { type: Date, default: null },
  sessionVersion: { type: Number, default: 1, required: true },
}, { collection: 'saas_customers', strict: 'throw', timestamps: true });
schema.index({ bakeryId: 1, email: 1 }, { unique: true });
module.exports = mongoose.model('SaasCustomer', schema);
