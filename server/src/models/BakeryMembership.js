const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bakery', required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  accountType: { type: String, enum: ['legacy', 'saas'], default: 'legacy', required: true },
  role: { type: String, enum: ['owner', 'staff'], required: true },
  active: { type: Boolean, default: true, required: true },
  version: { type: Number, default: 1, min: 1, required: true },
}, { timestamps: true });
schema.index({ bakeryId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, active: 1 });
module.exports = mongoose.model('BakeryMembership', schema);
