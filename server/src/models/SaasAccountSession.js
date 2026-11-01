const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 accountId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, tokenHash: { type: String, required: true, immutable: true, select: false },
 sessionVersion: { type: Number, required: true, immutable: true }, expiresAt: { type: Date, required: true, immutable: true },
}, { collection: 'saas_account_sessions', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ tokenHash: 1 }, { unique: true }); schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); schema.index({ accountId: 1, createdAt: -1 });
module.exports = mongoose.model('SaasAccountSession', schema);
