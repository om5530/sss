const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 accountId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 actionId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 purpose: { type: String, enum: ['email_verify', 'password_reset'], required: true, immutable: true },
 ciphertext: { type: String, required: true, immutable: true, select: false },
 iv: { type: String, required: true, immutable: true, select: false }, tag: { type: String, required: true, immutable: true, select: false },
 expiresAt: { type: Date, required: true, immutable: true },
}, { collection: 'saas_account_mail_previews', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ actionId: 1 }, { unique: true }); schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ accountId: 1, purpose: 1, createdAt: -1 });
module.exports = mongoose.model('SaasAccountMailPreview', schema);
