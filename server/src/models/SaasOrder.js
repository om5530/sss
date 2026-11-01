const mongoose = require('mongoose');
const item = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true }, quantity: { type: Number, required: true },
  unitPricePaise: { type: Number, required: true }, lineTotalPaise: { type: Number, required: true },
  stockEpoch: { type: Number },
  stockClaimed: { type: Boolean, required: true },
}, { _id: false, strict: 'throw' });
const cost = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  revisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  recipeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  revisionNumber: { type: Number, default: null }, yieldPieces: { type: Number, default: null },
  unitCostPaise: { type: String, default: null },
  batchCostPaise: { type: String, default: null },
}, { _id: false, strict: 'throw' });
const returned = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true }, quantity: { type: Number, required: true },
  status: { type: String, enum: ['restored', 'not_claimed', 'untracked', 'unversioned', 'count_changed', 'product_missing', 'overflow'], required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, immutable: true, select: false },
  source: { type: String, enum: ['counter', 'storefront'], immutable: true },
  fulfillment: { type: String, enum: ['pickup'], immutable: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  sequence: { type: Number, required: true, immutable: true },
  orderNumber: { type: String, required: true, immutable: true },
  items: { type: [item], required: true, default: undefined },
  costSnapshot: { type: [cost], default: undefined, select: false, immutable: true },
  subtotalPaise: { type: Number, required: true }, discountPaise: { type: Number, required: true }, totalPaise: { type: Number, required: true },
  pickupStatus: { type: String, enum: ['pending', 'ready', 'collected'] },
  pickupReadyAt: Date, pickupCollectedAt: Date,
  reservationStatus: { type: String, enum: ['active', 'cancelled', 'expired'] },
  reservationExpiresAt: { type: Date, immutable: true },
  reservationConfirmedAt: Date,
  reservationClosedAt: Date, reservationCloseReason: { type: String, maxlength: 500 },
  reservationReturns: { type: [returned], default: undefined },
  receivedPaise: { type: Number, default: undefined, min: 0, max: 1000000000000, validate: value => value === undefined || Number.isSafeInteger(value) },
  paymentStatus: { type: String, enum: ['paid', 'unpaid'], required: true },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card', null], default: null },
  comment: { type: String, default: '', maxlength: 1000 },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  idempotencyKey: { type: String, required: true, select: false },
  requestHash: { type: String, required: true, select: false },
  version: { type: Number, required: true, default: 1 },
  schemaVersion: { type: Number, required: true, default: 1, enum: [1] },
}, { collection: 'saas_orders', timestamps: true, strict: 'throw', toJSON: { transform: (_document, value) => {
  delete value.costSnapshot; delete value.idempotencyKey; delete value.requestHash; delete value.actorId; delete value.customerId;
  return value;
} } });
schema.index({ bakeryId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ bakeryId: 1, sequence: 1 }, { unique: true });
schema.index({ bakeryId: 1, eventId: 1, _id: -1 });
schema.index({ bakeryId: 1, customerId: 1, paymentStatus: 1, _id: -1 });
schema.index({ bakeryId: 1, source: 1, reservationStatus: 1, reservationExpiresAt: 1, _id: 1 });
module.exports = mongoose.model('SaasOrder', schema);
