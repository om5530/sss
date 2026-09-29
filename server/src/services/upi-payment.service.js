const ApiError = require('../utils/ApiError');
const { UPI_ID_PATTERN } = require('../config/upi');

function upiPaymentForOrder(order, settings) {
  const upiId = (settings.upiId || '').trim();
  const payeeName = (settings.payeeName || '').trim();
  if (!UPI_ID_PATTERN.test(upiId) || !payeeName) throw ApiError.badRequest('Set a valid UPI ID and account holder name in Store settings first');
  const amount = order.pricing.total;
  if (!Number.isFinite(amount) || amount <= 0 || order.pricing.currency?.toLowerCase() !== 'inr') {
    throw ApiError.badRequest('A UPI payment QR needs a positive order total in INR');
  }
  // Ordinary personal UPI request: do not invent merchant codes or PSP signatures.
  const values = { pa: upiId, pn: payeeName, am: amount.toFixed(2), cu: 'INR', tr: order.orderNumber, tn: `Order ${order.orderNumber}` };
  const uri = 'upi://pay?' + Object.entries(values).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return { recipientName: settings.name, upiId, payeeName, amount, discount: order.pricing.discount || 0,
    currency: 'INR', orderNumber: order.orderNumber, uri };
}
module.exports = { upiPaymentForOrder };
