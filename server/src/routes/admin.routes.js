const express = require('express');
const ctrl = require('../controllers/admin.controller');
const orderCtrl = require('../controllers/order.controller');
const contactCtrl = require('../controllers/contact.controller');
const couponCtrl = require('../controllers/coupon.controller');
const cakeCtrl = require('../controllers/cake.controller');
const uploadCtrl = require('../controllers/upload.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Every admin endpoint is role-gated server-side (AS-1.2) and never cacheable
// by browsers or proxies (AS-1.4).
router.use(requireAuth, requireRole('admin'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/dashboard', ctrl.dashboard);

router.get('/orders', ctrl.listOrders);
router.get('/orders/:id', ctrl.getOrderAdmin);
// Same lifecycle-enforced handler as the legacy /api/orders/:id/status route.
router.patch('/orders/:id/status', orderCtrl.updateOrderStatus);
// Records cash changing hands for a cash order (counter / pickup / delivery).
router.post('/orders/:id/settle-cash', ctrl.settleCashOrder);
router.post('/orders/:id/refund', ctrl.validators.refund, validate, ctrl.refundOrder);

router.get('/products', ctrl.listProductsAdmin);
router.get('/products/:id', ctrl.getProductAdmin);
router.post('/products', ctrl.validators.createProduct, validate, ctrl.createProduct);
router.patch('/products/:id', ctrl.validators.updateProduct, validate, ctrl.updateProduct);
router.patch('/products/:id/archive', ctrl.archiveProduct);

router.get('/customers', ctrl.listCustomers);
router.get('/customers/:id', ctrl.getCustomer);

router.get('/payments', ctrl.listPayments);

// Contact-form enquiries (triage: new → read → closed).
router.get('/messages', contactCtrl.listMessages);
router.patch('/messages/:id/status', contactCtrl.validators.updateStatus, validate, contactCtrl.updateMessageStatus);

// Custom-cake requests (triage: new → quoted → accepted/declined → closed).
router.get('/cake-requests', cakeCtrl.listRequests);
router.patch('/cake-requests/:id', cakeCtrl.validators.update, validate, cakeCtrl.updateRequest);

// Promo codes.
router.get('/coupons', couponCtrl.listCoupons);
router.post('/coupons', couponCtrl.validators.create, validate, couponCtrl.createCoupon);
router.patch('/coupons/:id', couponCtrl.updateCoupon);

// Product photo upload (5 MB, images only) → returns { url }.
router.post('/uploads', uploadCtrl.acceptImage, uploadCtrl.uploadProductImage);

router.get('/reports/sales', ctrl.salesReport);
router.get('/reports/products', ctrl.productReport);

router.get('/audit', ctrl.listAudit);

module.exports = router;
