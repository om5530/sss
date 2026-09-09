const mongoose = require('mongoose');

const bakeryWasteSchema = new mongoose.Schema(
  {
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BakeryMaterial',
      default: null,
    },
    materialName: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['raw_material', 'packaging', 'production_scrap', 'finished_good'],
      default: 'raw_material',
    },
    quantity: { type: Number, required: true, min: 0.001 },
    uom: { type: String, required: true, default: 'g' },
    unitCost: { type: Number, default: 0, min: 0 },
    totalCostLost: { type: Number, required: true, min: 0 },
    reason: {
      type: String,
      enum: [
        'Spoilage',
        'Dropped',
        'Burnt',
        'Overbaked',
        'Expired',
        'Trim',
        'Damaged',
        'Incorrect Recipe',
        'Unsold',
        'Other',
      ],
      default: 'Spoilage',
    },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

bakeryWasteSchema.index({ date: -1 });
bakeryWasteSchema.index({ reason: 1 });

module.exports = mongoose.model('BakeryWaste', bakeryWasteSchema);
