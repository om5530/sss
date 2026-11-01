const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  planId: { type: String, enum: ['starter', 'growth'], required: true },
  status: { type: String, enum: ['trialing', 'active', 'past_due', 'cancelled'], required: true },
  trialEndsAt: { type: Date, default: null }, currentPeriodEndsAt: { type: Date, default: null }, graceEndsAt: { type: Date, default: null },
  cancelAtPeriodEnd: { type: Boolean, required: true, default: false },
  version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });
module.exports = schema;
