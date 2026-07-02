const mongoose = require('mongoose');

// A promo code. Discount applies to the subtotal (before tax + delivery);
// tax is charged on the discounted amount.
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },
    // Order must reach this subtotal before the code applies.
    minSubtotal: { type: Number, default: 0, min: 0 },
    // Cap for percent coupons (null = uncapped).
    maxDiscount: { type: Number, default: null },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    // Total redemptions allowed across all customers (null = unlimited).
    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Coupon', couponSchema);
