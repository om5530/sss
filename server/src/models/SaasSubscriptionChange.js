const mongoose = require('mongoose');
const subscription = require('./saas-subscription-schema');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  operationKey: { type: String, required: true, immutable: true, select: false },
  requestHash: { type: String, required: true, immutable: true, select: false },
  before: { type: subscription, default: null, immutable: true }, after: { type: subscription, required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
}, { collection: 'saas_subscription_changes', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, operationKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, 'after.version': 1 }, { unique: true });
module.exports = mongoose.model('SaasSubscriptionChange', schema);
