const express = require('express');
const ctrl = require('../controllers/payment.controller');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Note: POST /api/payments/webhook is registered separately in app.js because
// it needs the raw request body for Stripe signature verification.
// Paying for an order works for guests too (dine-in / takeaway); ownership is
// checked in the controller against the order's user.
router.post('/:orderId/intent', paymentLimiter, optionalAuth, ctrl.createIntent);
router.post('/:orderId/razorpay/verify', paymentLimiter, optionalAuth, ctrl.verifyRazorpayPayment);
router.post('/:orderId/confirm-mock', paymentLimiter, optionalAuth, ctrl.confirmMockPayment);
router.get('/:orderId', requireAuth, ctrl.getPaymentForOrder);

module.exports = router;
