const mongoose = require('mongoose');

const ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
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
    // Optional: dine-in and takeaway support guest checkout. Delivery orders
    // always have a user (enforced in the order controller).
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    items: {
      type: [orderItemSchema],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Order must contain at least one item' },
    },
    orderType: { type: String, enum: ['dining', 'takeaway', 'delivery'], required: true },
    dining: { tableNumber: String, customerName: String },
    takeaway: { customerName: String, phone: String },
    delivery: { fullAddress: String, area: String, city: String, pincode: String, landmark: String },
    pricing: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      couponCode: { type: String },
      tax: { type: Number, required: true },
      deliveryFee: { type: Number, default: 0 },
      total: { type: Number, required: true },
      currency: { type: String, default: 'inr' },
    },
    // 'online' goes through the payment gateway; 'cash' is settled in person
    // (counter / pickup / delivery) and marked paid by staff.
    paymentMethod: { type: String, enum: ['online', 'cash'], default: 'online' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'placed' },
    statusHistory: { type: [statusEventSchema], default: [] },
  },
  { timestamps: true },
);

orderSchema.statics.STATUSES = ORDER_STATUSES;

module.exports = mongoose.model('Order', orderSchema);
