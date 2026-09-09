const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true },
  group: { type: String, enum: ['bakery', 'savoury'], required: true },
  displayOrder: { type: Number, default: Date.now },
  archived: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ group: 1, nameKey: 1 }, { unique: true });
module.exports = mongoose.model('Category', schema);
