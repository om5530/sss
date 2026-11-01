const mongoose = require('mongoose');
const paise = { type: Number, default: 0, min: 0, max: 1000000000000, validate: Number.isSafeInteger };
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  name: { type: String, required: true, maxlength: 120 },
  key: { type: String, required: true, maxlength: 120, immutable: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open', required: true },
  rentPaise: paise, travelPaise: paise, extraPaise: paise,
  version: { type: Number, default: 1, required: true },
  schemaVersion: { type: Number, default: 1, enum: [1], required: true },
}, { collection: 'saas_events', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1, key: 1 }, { unique: true });
schema.index({ bakeryId: 1, status: 1, _id: -1 });
module.exports = mongoose.model('SaasEvent', schema);
