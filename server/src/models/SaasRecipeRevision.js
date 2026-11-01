const mongoose = require('mongoose');
const { UNITS } = require('../saas/recipe-input');
const ingredient = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true }, materialVersion: { type: Number, required: true },
  name: { type: String, required: true }, type: { type: String, required: true },
  quantity: { type: String, required: true }, uom: { type: String, enum: UNITS, required: true },
  packQuantity: { type: String, required: true }, packUom: { type: String, enum: UNITS, required: true },
  purchasePricePaise: { type: Number, required: true }, costPaise: { type: String, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  revisionNumber: { type: Number, required: true, immutable: true },
  yieldPieces: { type: Number, required: true, min: 1, max: 1000000, immutable: true },
  label: { type: String, maxlength: 120, immutable: true },
  notes: { type: String, maxlength: 2000, immutable: true },
  overheadPaise: { type: Number, required: true, immutable: true },
  ingredients: { type: [ingredient], default: undefined, required: true, immutable: true },
  batchCostPaise: { type: String, required: true, immutable: true },
  unitCostPaise: { type: String, required: true, immutable: true },
  schemaVersion: { type: Number, default: 1, enum: [1], required: true },
}, { collection: 'saas_recipe_revisions', timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' });
schema.index({ bakeryId: 1, recipeId: 1, revisionNumber: 1 }, { unique: true });
module.exports = mongoose.model('SaasRecipeRevision', schema);
