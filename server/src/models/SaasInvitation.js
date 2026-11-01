const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  tokenHash: { type: String, required: true, immutable: true, select: false },
  expiresAt: { type: Date, required: true, immutable: true },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  acceptedAccountType: { type: String, enum: ['legacy', 'saas'], default: 'legacy' },
  acceptedAt: { type: Date, default: null }, revokedAt: { type: Date, default: null },
  version: { type: Number, required: true, default: 1 },
}, { collection: 'saas_invitations', timestamps: true, strict: 'throw' });
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ bakeryId: 1, _id: -1 });
schema.index({ bakeryId: 1, expiresAt: 1, acceptedBy: 1, revokedAt: 1 });
module.exports = mongoose.model('SaasInvitation', schema);
