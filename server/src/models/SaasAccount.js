const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 email: { type: String, required: true, maxlength: 254 }, displayName: { type: String, required: true, maxlength: 120 },
 passwordHash: { type: String, required: true, select: false }, active: { type: Boolean, default: true, required: true },
 emailPreviewConfirmedAt: { type: Date, default: null },
 emailVerified: { type: Boolean, default: false, required: true }, sessionVersion: { type: Number, default: 1, required: true },
}, { collection: 'saas_accounts', strict: 'throw', timestamps: true });
schema.index({ email: 1 }, { unique: true });
module.exports = mongoose.model('SaasAccount', schema);
