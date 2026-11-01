const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  pickupReservationMinutes: { type: Number, default: 30, required: true, min: 5, max: 1440, validate: Number.isSafeInteger },
  acceptCustomerOrders: { type: Boolean, required: true, default: false },
  published: { type: Boolean, required: true, default: false },
  brandTheme: { type: String, enum: require('../saas/storefront-branding').THEMES, default: 'gold', required: true },
  brandMark: { type: String, default: '', maxlength: 4, match: /^[A-Z0-9]{0,4}$/ },
  tagline: { type: String, default: '', maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  contactPhone: { type: String, default: '', maxlength: 30 },
  contactEmail: { type: String, default: '', maxlength: 254 },
  address: { type: String, default: '', maxlength: 500 },
  openingHours: { type: String, default: '', maxlength: 200 },
  showUnavailable: { type: Boolean, required: true, default: false },
  version: { type: Number, default: 1, required: true },
  schemaVersion: { type: Number, default: 1, enum: [1], required: true },
}, { collection: 'saas_storefronts', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1 }, { unique: true });
module.exports = mongoose.model('SaasStorefront', schema);
