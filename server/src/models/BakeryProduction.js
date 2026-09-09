const mongoose = require('mongoose');

const bakeryProductionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    type: {
      type: String,
      enum: ['costing_sheet', 'production_plan', 'batch'],
      default: 'costing_sheet',
      required: true,
    },
    referenceName: { type: String, trim: true, default: '' },
    customerName: { type: String, trim: true, default: '' },
    productionDate: { type: Date, default: Date.now },

    // List of recipes & quantities included
    items: [
      {
        recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'BakeryRecipe' },
        recipeName: { type: String, default: '' },
        quantity: { type: Number, required: true, min: 0.01 },
        yieldUom: { type: String, default: 'unit' },
        batchCost: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
      },
    ],

    // Aggregated kitchen breakdown
    aggregatedIngredients: [
      {
        materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'BakeryMaterial' },
        name: { type: String, default: '' },
        quantity: { type: Number, default: 0 },
        uom: { type: String, default: 'g' },
        unitCost: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
      },
    ],
    aggregatedPackaging: [
      {
        materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'BakeryMaterial' },
        name: { type: String, default: '' },
        quantity: { type: Number, default: 0 },
        uom: { type: String, default: 'piece' },
        unitCost: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
      },
    ],
    aggregatedLabour: [
      {
        name: { type: String, default: '' },
        minutes: { type: Number, default: 0 },
        ratePerMinute: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
      },
    ],
    aggregatedResources: [
      {
        name: { type: String, default: '' },
        cycles: { type: Number, default: 1 },
        minutes: { type: Number, default: 60 },
        ratePerMinute: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
      },
    ],

    // Total Financials
    ingredientCost: { type: Number, default: 0 },
    packagingCost: { type: Number, default: 0 },
    labourCost: { type: Number, default: 0 },
    resourceCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },

    markupPercent: { type: Number, default: 50 },
    marginPercent: { type: Number, default: 33.33 },
    suggestedSellingPrice: { type: Number, default: 0 },
    quotedPrice: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'completed', 'cancelled'],
      default: 'draft',
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

bakeryProductionSchema.index({ type: 1, createdAt: -1 });
bakeryProductionSchema.index({ status: 1 });

module.exports = mongoose.model('BakeryProduction', bakeryProductionSchema);
