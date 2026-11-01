const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  fromVersion: { type: Number, required: true, immutable: true },
  toVersion: { type: Number, required: true, immutable: true },
  beforeDiscountPaise: { type: Number, required: true, immutable: true },
  afterDiscountPaise: { type: Number, required: true, immutable: true },
  beforeTotalPaise: { type: Number, required: true, immutable: true },
  afterTotalPaise: { type: Number, required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
}, { collection: 'saas_order_changes', strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });
schema.index({ bakeryId: 1, orderId: 1, toVersion: 1 }, { unique: true });
schema.index({ bakeryId: 1, orderId: 1, _id: -1 });
module.exports = mongoose.model('SaasOrderChange', schema);
