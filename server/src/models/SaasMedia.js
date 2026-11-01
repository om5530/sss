const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 kind: { type: String, enum: ['logo', 'product'], required: true, immutable: true },
 targetId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 version: { type: Number, required: true, default: 1, min: 1 }, active: { type: Boolean, required: true, default: true },
 bytes: { type: Buffer, select: false }, hash: { type: String, default: '' },
 byteLength: { type: Number, required: true, default: 0, min: 0, max: 131072 },
 width: { type: Number, default: 0 }, height: { type: Number, default: 0 },
}, { collection: 'saas_media', strict: 'throw', timestamps: true });
schema.index({ bakeryId: 1, kind: 1, targetId: 1 }, { unique: true });
schema.index({ bakeryId: 1, active: 1 });
module.exports = mongoose.model('SaasMedia', schema);
