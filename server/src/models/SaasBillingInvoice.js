const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true }, checkoutId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
 providerInvoiceId: { type: String, required: true, immutable: true }, status: { type: String, required: true }, amountPaise: { type: Number, required: true }, paidPaise: { type: Number, required: true }, duePaise: { type: Number, required: true },
 billingStart: Date, billingEnd: Date, hostedUrl: String,
}, { collection: 'saas_billing_invoices', timestamps: true, strict: 'throw' });
schema.index({ bakeryId: 1, providerInvoiceId: 1 }, { unique: true });
schema.index({ bakeryId: 1, _id: -1 });
module.exports = mongoose.model('SaasBillingInvoice', schema);
