const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  unit: { type: String, enum: ['g', 'ml', 'piece', 'packet', 'box'], required: true, immutable: true },
  onHand: { type: String, required: true }, version: { type: Number, default: 1, required: true },
}, { collection: 'saas_material_stocks', strict: 'throw', timestamps: true });
schema.index({ bakeryId: 1, materialId: 1 }, { unique: true });
schema.index({ bakeryId: 1, _id: -1 });
module.exports = mongoose.model('SaasMaterialStock', schema);
