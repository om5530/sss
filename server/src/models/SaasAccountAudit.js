const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 accountId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, action: { type: String, enum: ['register', 'login', 'logout', 'password.change', 'password.requestReset', 'password.reset', 'email.requestPreview', 'email.confirmPreview'], required: true, immutable: true },
 sessionId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
}, { collection: 'saas_account_audit', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ accountId: 1, createdAt: -1 }); module.exports = mongoose.model('SaasAccountAudit', schema);
