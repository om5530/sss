const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bakeryId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  actorType: { type: String, enum: ['staff', 'customer', 'platform'], immutable: true },
  action: { type: String, enum: ['media.update', 'billing.checkout', 'billing.attach', 'billing.sync', 'billing.cancel', 'subscription.change', 'bakery.create', 'bakery.rename', 'product.create', 'product.update', 'product.archive', 'product.restore',
    'material.create', 'material.update', 'recipe.create', 'recipe.revise', 'recipe.update', 'product.mapRecipe',
    'event.create', 'event.close', 'order.create', 'order.pickupReady', 'order.pickupCollect', 'order.settle', 'order.discount', 'order.refund', 'settings.update', 'production.record', 'inventory.record', 'customer.requestReset', 'customer.requestVerification', 'customer.resetPassword', 'customer.previewVerification', 'customer.changePassword', 'customer.register', 'customer.login', 'customer.logout', 'customer.order', 'reservation.cancel', 'reservation.expire', 'waste.record',
    'team.invite', 'team.revokeInvite', 'team.revokeMember', 'team.join'], required: true, immutable: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  fromVersion: { type: Number, min: 0, required: true, immutable: true },
  toVersion: { type: Number, min: 1, required: true, immutable: true },
  // Metadata only: descriptions, prices, customer data, tokens and request
  // bodies are deliberately not copied into the security log.
  fields: { type: [String], required: true, immutable: true,
    validate: value => value.length <= 20 && value.every(field => /^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(field)) },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'saas_audit_logs', strict: 'throw' });
schema.index({ bakeryId: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('SaasAuditLog', schema);
