function pickupState(order) {
  if (order.source !== 'storefront' || order.fulfillment !== 'pickup') return {};
  return { pickupStatus: order.pickupStatus || 'pending', pickupReadyAt: order.pickupReadyAt || null, pickupCollectedAt: order.pickupCollectedAt || null };
}
module.exports = { pickupState };
