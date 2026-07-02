const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    group: { type: String, enum: ['bakery', 'savoury'], required: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: '' },
    dietary: { type: String, enum: ['veg', 'non-veg', 'egg'], default: 'veg' },
    tags: { type: [String], default: [] },
    available: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    // Daily bake count. null = not tracked (availability is manual). When
    // tracked, orders decrement it atomically and 0 auto-flips `available`.
    stockCount: { type: Number, default: null, min: 0 },
    // Denormalised review stats, recomputed on every review write.
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    // Soft delete (AS-4.5): archived products disappear from the storefront but
    // stay in the database so historical orders keep rendering.
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ group: 1, category: 1 });
productSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);
