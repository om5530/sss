const express = require('express');
const mongoose = require('mongoose');
const dbReady = require('../middleware/dbReady');
const stripeService = require('../services/stripe.service');
const razorpayService = require('../services/razorpay.service');
const { isConfigured: googleConfigured } = require('../services/google.service');
const { shopInfo } = require('../services/shop.service');
const asyncHandler = require('../utils/asyncHandler');
const { getStoreSettings } = require('../services/store-settings.service');

const authRoutes = require('./auth.routes');
const productRoutes = require('./product.routes');
const cartRoutes = require('./cart.routes');
const orderRoutes = require('./order.routes');
const paymentRoutes = require('./payment.routes');
const contactRoutes = require('./contact.routes');
const cakeRoutes = require('./cake.routes');
const adminRoutes = require('./admin.routes');
const bakeryRoutes = require('./bakery.routes');
const { foundationAvailable, foundationDatabaseAllowed } = require('../config/saas-foundation');
const ApiError = require('../utils/ApiError');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    integrations: {
      payments: razorpayService.isEnabled() ? 'razorpay' : stripeService.isEnabled() ? 'stripe' : 'mock',
      google: googleConfigured() ? 'configured' : 'not-configured',
    },
  });
});

// Opening hours + open-now — no DB needed, safe for banners and pickers.
router.get('/shop', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, shop: shopInfo(await getStoreSettings()) });
}));

// Everything below requires a live database connection.
router.use(dbReady);
router.use('/auth', authRoutes);
// Do not register SaaS models while disabled: Mongoose model registration can
// otherwise create collections/indexes when the existing database connects.
router.use('/saas', (req, res, next) => {
  if (!foundationAvailable() || !foundationDatabaseAllowed(mongoose.connection) || !require('../config/saas-local-routing').localAuthority(req.get('host'))) {
    res.set('Cache-Control', 'no-store');
    return next(ApiError.notFound('Route not found'));
  }
  return require('./saas-foundation.routes')(req, res, next);
});
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/contact', contactRoutes);
router.use('/cake-requests', cakeRoutes);
router.use('/custom-requests', cakeRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/bakery', bakeryRoutes);

module.exports = router;
