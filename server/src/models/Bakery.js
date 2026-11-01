const mongoose = require('mongoose');

// Additive foundation only: no legacy business records are backfilled here.
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, immutable: true,
    minlength: 3, maxlength: 60, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  status: { type: String, enum: ['active', 'suspended'], default: 'active', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  createdByType: { type: String, enum: ['legacy', 'saas'], default: 'legacy', required: true },
  currency: { type: String, default: 'inr', enum: ['inr'], required: true },
  timezone: { type: String, default: 'Asia/Kolkata', enum: ['Asia/Kolkata'], required: true },
  version: { type: Number, default: 1, min: 1, required: true },
  billingCheckoutId: { type: mongoose.Schema.Types.ObjectId },
  subscription: { type: require('./saas-subscription-schema'), default: undefined },
  nextOrderNumber: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ slug: 1 }, { unique: true });
schema.index({ createdBy: 1, createdByType: 1 });
module.exports = mongoose.model('Bakery', schema);
