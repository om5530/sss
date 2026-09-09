const mongoose = require('mongoose');
const env = require('../config/env');

// One document holds operational values that used to require an environment
// change and deployment. The stable id makes reads and updates race-safe.
const storeSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'store' },
    taxRate: { type: Number, required: true, min: 0, max: 1, default: env.pricing.taxRate },
    deliveryFee: { type: Number, required: true, min: 0, default: env.pricing.deliveryFee },
    currency: { type: String, required: true, lowercase: true, match: /^[a-z]{3}$/, default: env.pricing.currency },
    opensAt: { type: String, required: true, default: env.shop.opensAt },
    closesAt: { type: String, required: true, default: env.shop.closesAt },
    contactAddress: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model('StoreSettings', storeSettingsSchema);
