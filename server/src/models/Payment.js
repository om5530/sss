const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    // Optional: guest dine-in / takeaway payments have no account.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // 'razorpay' | 'stripe' | 'cash' — which rail settled (or will settle) it.
    provider: { type: String, default: 'stripe' },
    stripePaymentIntentId: { type: String, index: true },
    // Current Razorpay order (what new Checkout.js sessions open against)…
    razorpayOrderId: { type: String, index: true },
    // …plus every order id ever issued for this payment: a retry creates a new
    // Razorpay order, but a customer can still pay an older, still-open popup —
    // the webhook must be able to resolve captures on ANY of them.
    razorpayOrderIds: { type: [String], index: true, default: [] },
    razorpayPaymentId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'inr' },
    method: { type: String },
    status: {
      type: String,
      enum: ['requires_payment', 'processing', 'succeeded', 'failed', 'refunded'],
      default: 'requires_payment',
    },
    mock: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Payment', paymentSchema);
