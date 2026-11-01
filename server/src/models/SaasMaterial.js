const mongoose = require('mongoose');
const { UNITS } = require('../saas/recipe-input');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  name: { type: String, required: true, maxlength: 120 },
  type: { type: String, enum: ['ingredient', 'packaging', 'resource', 'labour'], required: true, default: 'ingredient' },
  packQuantity: { type: String, required: true },
  packUom: { type: String, enum: UNITS, required: true },
  purchasePricePaise: { type: Number, required: true, min: 0, max: 100000000, validate: Number.isSafeInteger },
  active: { type: Boolean, default: true, required: true },
  version: { type: Number, default: 1, required: true },
  schemaVersion: { type: Number, default: 1, enum: [1], required: true },
}, { collection: 'saas_materials', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1, active: 1, _id: -1 });
module.exports = mongoose.model('SaasMaterial', schema);
