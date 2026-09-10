const mongoose = require('mongoose');

const recipeComponentSchema = new mongoose.Schema(
  {
    componentType: {
      type: String,
      enum: ['material', 'sub_recipe', 'other'],
      default: 'material',
      required: true,
    },
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BakeryMaterial',
      default: null,
    },
    subRecipeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BakeryRecipe',
      default: null,
    },
    // Snapshot of name at configuration time for quick display
    name: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    // Type classification for grouping: ingredient, packaging, labour, resource
    itemType: {
      type: String,
      enum: ['ingredient', 'sub_recipe', 'packaging', 'resource', 'labour', 'other'],
      default: 'ingredient',
    },
    quantity: { type: Number, required: true, min: 0 },
    workers: { type: String, default: '1' },
    uom: { type: String, required: true, default: 'g' },

    // Scaling rules:
    // 'linear' (default, e.g. flour 192g * 7)
    // 'stepped' (e.g. oven: capacity 4 cakes per cycle, so 5 cakes = 2 cycles)
    // 'fixed' (fixed per batch regardless of count)
    scalingMethod: {
      type: String,
      enum: ['linear', 'stepped', 'fixed'],
      default: 'linear',
    },
    capacityPerCycle: { type: Number, default: 1, min: 1 },
    cycleMinutes: { type: Number, default: 60, min: 0 },

    // Denormalized unit cost and subtotal for fast previews
    unitCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
  },
  { _id: true },
);

require('./bakeryDecimal')(recipeComponentSchema, ['quantity', 'unitCost', 'totalCost']);
const bakeryRecipeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    category: { type: String, trim: true, default: 'Cakes' },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['draft', 'active'], default: 'active' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    overheadPerBatch: { type: String, default: '0' },
    expectedLossPercent: { type: String, default: '0' },
    options: [{ name: String, components: [recipeComponentSchema] }],
    isSubRecipe: { type: Boolean, default: false },

    // Expected Output
    baseBatchUnits: { type: Number, required: true, default: 1, min: 0.01 },
    yieldQuantity: { type: Number, required: true, default: 1, min: 0.01 },
    yieldUom: { type: String, required: true, default: 'cake' },
    finishedWeightGrams: { type: Number, default: 0, min: 0 },

    components: [recipeComponentSchema],

    // Cost Breakdown Cache
    ingredientCost: { type: Number, default: 0 },
    packagingCost: { type: Number, default: 0 },
    labourCost: { type: Number, default: 0 },
    resourceCost: { type: Number, default: 0 },
    totalBatchCost: { type: Number, default: 0 },
    costPerUnit: { type: Number, default: 0 },

    // Pricing rules
    targetMarkupPercent: { type: Number, default: 50, min: 0 },
    suggestedSellingPrice: { type: Number, default: 0 },
    manualSellingPrice: { type: Number, default: 0 },

    instructions: { type: [String], default: [] },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

bakeryRecipeSchema.pre('validate', function (next) {
  if (this.yieldQuantity && (!this.baseBatchUnits || this.baseBatchUnits === 1)) {
    this.baseBatchUnits = this.yieldQuantity;
  } else if (this.baseBatchUnits && (!this.yieldQuantity || this.yieldQuantity === 1)) {
    this.yieldQuantity = this.baseBatchUnits;
  }
  next();
});

require('./bakeryDecimal')(bakeryRecipeSchema, ['baseBatchUnits', 'yieldQuantity', 'finishedWeightGrams', 'ingredientCost', 'packagingCost', 'labourCost', 'resourceCost', 'totalBatchCost', 'costPerUnit', 'targetMarkupPercent', 'suggestedSellingPrice', 'manualSellingPrice']);
bakeryRecipeSchema.index({ name: 1, category: 1 });
bakeryRecipeSchema.index({ isSubRecipe: 1 });

module.exports = mongoose.model('BakeryRecipe', bakeryRecipeSchema);
