const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, checkoutId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 eventId: { type: String, required: true, immutable: true }, payloadHash: { type: String, required: true, immutable: true, select: false }, eventType: { type: String, required: true, immutable: true },
 providerSubscriptionId: { type: String, required: true, immutable: true }, processedAt: { type: Date, default: null },
}, { collection: 'saas_billing_events', timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' });
schema.index({ eventId: 1 }, { unique: true }); schema.index({ bakeryId: 1, processedAt: 1, _id: 1 });
module.exports = mongoose.model('SaasBillingEvent', schema);
