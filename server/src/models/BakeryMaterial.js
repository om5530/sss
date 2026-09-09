const mongoose = require('mongoose');

const bakeryMaterialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    type: {
      type: String,
      enum: ['ingredient', 'packaging', 'resource', 'labour'],
      default: 'ingredient',
      required: true,
    },
    category: { type: String, trim: true, default: 'General' },
    baseUom: {
      type: String,
      enum: ['g', 'kg', 'ml', 'L', 'piece', 'dozen', 'box', 'minute', 'hour'],
      required: true,
      default: 'g',
    },
    // Optional liquid density (g/ml) for mass-volume conversion when applicable
    densityGramPerMl: { type: Number, default: 1.0, min: 0.01 },

    // Purchase Pack definition (Never manually enter price per gram)
    packQuantity: { type: Number, required: true, min: 0.0001, default: 1000 },
    packUom: { type: String, required: true, default: 'g' },
    purchasePrice: { type: Number, required: true, min: 0, default: 0 },
    // Calculated automatically: purchasePrice / (packQuantity converted to baseUom)
    effectiveUnitCost: { type: Number, required: true, min: 0, default: 0 },

    // Stock tracking
    currentStock: { type: Number, default: 0, min: 0 },
    minimumStock: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },

    // Supplier & Procurement info
    supplierName: { type: String, trim: true, default: '' },
    brand: { type: String, trim: true, default: '' },
    leadTimeDays: { type: Number, default: 1, min: 0 },

    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

bakeryMaterialSchema.pre('validate', function (next) {
  if (this.get('baseUnit') && !this.baseUom) this.baseUom = this.get('baseUnit');
  if (this.get('packUnit') && !this.packUom) this.packUom = this.get('packUnit');
  next();
});

bakeryMaterialSchema.pre('save', function (next) {
  if (
    this.isModified('packQuantity') ||
    this.isModified('purchasePrice') ||
    this.isModified('packUom') ||
    this.isModified('baseUom') ||
    !this.effectiveUnitCost
  ) {
    const costEngine = require('../services/bakeryCost.service');
    this.effectiveUnitCost = costEngine.calculateEffectiveUnitCost(
      this.packQuantity,
      this.packUom,
      this.purchasePrice,
      this.baseUom,
      this.densityGramPerMl,
    );
  }
  next();
});

bakeryMaterialSchema.index({ type: 1, category: 1 });
bakeryMaterialSchema.index({ name: 'text', code: 'text' });

module.exports = mongoose.model('BakeryMaterial', bakeryMaterialSchema);
