const mongoose = require('mongoose');

// One shared SaaS catalogue, partitioned by bakeryId. Keep it separate from the
// unscoped legacy Product collection until all legacy callers are migrated.
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bakery', required: true, immutable: true },
  // Enum plus API field whitelists keep this fixed. immutable + default under
  // strict:'throw' makes Mongoose hydration record a spurious default error.
  schemaVersion: { type: Number, enum: [1], default: 1, required: true },
  stockEpoch: { type: Number, default: 1, required: true, min: 1 },
  version: { type: Number, default: 1, required: true, min: 1 },
  name: { type: String, trim: true, required: true, maxlength: 120 },
  slug: { type: String, trim: true, lowercase: true, required: true, maxlength: 120,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  description: { type: String, default: '', maxlength: 2000 },
  category: { type: String, trim: true, required: true, maxlength: 100 },
  group: { type: String, enum: ['bakery', 'savoury'], default: 'bakery', required: true },
  dietary: { type: String, enum: ['veg', 'non-veg', 'egg'], default: 'veg', required: true },
  // Integer paise avoids floating-point INR arithmetic in the new API.
  pricePaise: { type: Number, required: true, min: 0, max: 100000000, validate: Number.isSafeInteger },
  stockCount: { type: Number, default: null, min: 0, max: 1000000,
    validate: value => value === null || Number.isSafeInteger(value) },
  available: { type: Boolean, default: true, required: true },
  featured: { type: Boolean, default: false, required: true },
  archived: { type: Boolean, default: false, required: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  recipeRevisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true, collection: 'saas_products', strict: 'throw' });

schema.index({ bakeryId: 1, slug: 1 }, { unique: true });
schema.index({ bakeryId: 1, archived: 1, _id: -1 });
schema.index({ bakeryId: 1, recipeId: 1 });
module.exports = mongoose.model('SaasProduct', schema);
