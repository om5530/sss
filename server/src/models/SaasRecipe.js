const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  name: { type: String, required: true, maxlength: 120 },
  category: { type: String, required: true, maxlength: 100 },
  archived: { type: Boolean, required: true, default: false },
  version: { type: Number, required: true, default: 1 },
  latestRevisionNumber: { type: Number, required: true, default: 1 },
  schemaVersion: { type: Number, required: true, default: 1, enum: [1] },
}, { collection: 'saas_recipes', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1, archived: 1, _id: -1 });
module.exports = mongoose.model('SaasRecipe', schema);
