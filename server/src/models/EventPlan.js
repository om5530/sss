const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  quantity: { type: Number, required: true, min: 1 },
  unitCost: { type: String, required: true },
  recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'BakeryRecipe', required: true },
  recipeVersion: { type: Number, required: true },
  recordedAt: { type: Date, default: Date.now },
}, { _id: false });
const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  batches: { type: [batchSchema], default: [] },
  wasted: { type: Number, default: 0, min: 0 },
  reusable: { type: Number, default: 0, min: 0 },
  returned: { type: Number, default: 0, min: 0 },
}, { _id: false });
const schema = new mongoose.Schema({
  eventName: { type: String, required: true, maxlength: 120 },
  eventKey: { type: String, required: true, unique: true },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  rent: { type: Number, default: 0, min: 0 },
  travelCost: { type: Number, default: 0, min: 0 },
  extraCost: { type: Number, default: 0, min: 0 },
  extraCostNote: { type: String, maxlength: 1000, default: '' },
  items: { type: [itemSchema], default: [] },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  version: { type: Number, default: 1 },
  closedAt: { type: Date, default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  finalReport: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model('EventPlan', schema);
