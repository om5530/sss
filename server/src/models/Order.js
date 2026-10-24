const mongoose = require('mongoose');

const ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
    // True when this line actually decremented tracked stock at order time.
    // Cancellation restocks EXACTLY these lines — a product that was untracked
    // when ordered but tracked later must not gain phantom units.
    stockClaimed: { type: Boolean, default: false },
  },
  { _id: false },
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    // Private cost at sale time; excluded from customer order responses.
    recipeCostSnapshot: { type: [{ product: mongoose.Schema.Types.ObjectId, unitCost: String, recipeId: mongoose.Schema.Types.ObjectId, recipeVersion: Number }], select: false, default: undefined },
    // Website delivery requires an account; staff-entered delivery does not.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    items: {
      type: [orderItemSchema],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Order must contain at least one item' },
    },
    orderType: { type: String, enum: ['dining', 'takeaway', 'delivery'], required: true },
    source: { type: String, enum: ['website', 'phone', 'walk-in', 'event'], default: 'website', index: true },
    eventName: { type: String, trim: true, maxlength: 120, default: '', index: true },
    upiRecipient: { id: String, name: String, upiId: String, payeeName: String },
    customer: { name: { type: String, maxlength: 120 }, phone: { type: String, maxlength: 20 } },
    notes: { type: String, maxlength: 1000, default: '' },
    comment: { type: String, trim: true, maxlength: 1000, default: '', select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // A retried staff submission must not create another sale or claim stock twice.
    manualKey: { type: String, unique: true, sparse: true, select: false },
    manualHash: { type: String, select: false },
    // Scheduled pre-order time; null = ASAP. Validated against opening hours.
    fulfilAt: { type: Date, default: null, index: true },
    dining: { tableNumber: String, customerName: String },
    takeaway: { customerName: String, phone: String },
    delivery: { fullAddress: String, area: String, city: String, pincode: String, landmark: String },
    pricing: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      couponCode: { type: String },
      tax: { type: Number, required: true },
      taxRate: { type: Number, min: 0 },
      deliveryFee: { type: Number, default: 0 },
      total: { type: Number, required: true },
      currency: { type: String, default: 'inr' },
    },
    // 'online' goes through the payment gateway; 'cash' is settled in person
    // (counter / pickup / delivery) and marked paid by staff.
    paymentMethod: { type: String, enum: ['online', 'cash', 'upi', 'card'], default: 'online' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'placed' },
    statusHistory: { type: [statusEventSchema], default: [] },
  },
  { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.recipeCostSnapshot; return ret; } } },
);

orderSchema.statics.STATUSES = ORDER_STATUSES;

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ source: 1, eventName: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
