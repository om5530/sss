const express = require('express');
const ctrl = require('../controllers/cart.controller');
const { pricingLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Rate-limited: this is also where coupon codes get validated, so an open
// endpoint would be a coupon brute-forcing oracle.
router.post('/price', pricingLimiter, ctrl.priceCartHandler);

module.exports = router;
