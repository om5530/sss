const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 planId: { type: String, enum: ['starter', 'growth'], required: true, immutable: true }, providerPlanId: { type: String, required: true, immutable: true },
 amountPaise: { type: Number, required: true, immutable: true }, cycles: { type: Number, default: 12, enum: [12], required: true },
 keyId: { type: String, required: true, immutable: true, select: false }, accountId: { type: String, required: true, immutable: true, select: false },
 operationKey: { type: String, required: true, immutable: true, select: false }, requestHash: { type: String, required: true, immutable: true, select: false },
 current: { type: Boolean, required: true, default: true }, version: { type: Number, default: 1, required: true },
 phase: { type: String, enum: ['creating', 'ready'], default: 'creating', required: true }, providerSubscriptionId: String,
 hostedUrl: { type: String, select: false }, providerStatus: { type: String, default: 'created' }, paidThrough: { type: Date, default: null },
 cancelState: { type: String, enum: ['none', 'pending', 'uncertain', 'confirmed'], default: 'none', required: true }, cancelAttemptAt: Date,
 synchronizedAt: Date,
}, { collection: 'saas_billing_checkouts', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1, operationKey: 1 }, { unique: true });
schema.index({ bakeryId: 1 }, { unique: true, partialFilterExpression: { current: true } });
schema.index({ providerSubscriptionId: 1 }, { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: 'string' } } });
module.exports = mongoose.model('SaasBillingCheckout', schema);
