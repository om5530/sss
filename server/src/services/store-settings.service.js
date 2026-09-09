const mongoose = require('mongoose');
const env = require('../config/env');
const StoreSettings = require('../models/StoreSettings');

const DEFAULTS = {
  _id: 'store',
  taxRate: env.pricing.taxRate,
  deliveryFee: env.pricing.deliveryFee,
  currency: env.pricing.currency,
  opensAt: env.shop.opensAt,
  closesAt: env.shop.closesAt,
  contactAddress: '',
  contactPhone: '',
  contactEmail: '',
};

function fallbackSettings() {
  return { ...DEFAULTS };
}

async function getStoreSettings() {
  // Public banners should remain usable during a database outage. All routes
  // that create orders still pass through dbReady before querying products.
  if (mongoose.connection.readyState !== 1) return fallbackSettings();
  const current = await StoreSettings.findById('store').lean();
  if (current) return current;
  try {
    return (await StoreSettings.create(DEFAULTS)).toObject();
  } catch (err) {
    if (err.code !== 11000) throw err;
    return StoreSettings.findById('store').lean();
  }
}

async function updateStoreSettings(changes) {
  return StoreSettings.findOneAndUpdate(
    { _id: 'store' },
    { $set: changes, $setOnInsert: Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => !(key in changes))) },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}

module.exports = { DEFAULTS, getStoreSettings, updateStoreSettings };
