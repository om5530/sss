const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    fullAddress: { type: String, required: true, trim: true },
    area: { type: String, trim: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    landmark: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    googleId: { type: String },
    firebaseUid: { type: String },
    avatar: { type: String },
    addresses: { type: [addressSchema], default: [] },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

// Unique only when present, so an account can have either email or phone.
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ firebaseUid: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);
