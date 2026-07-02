const express = require('express');
const ctrl = require('../controllers/order.controller');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Guest checkout: dine-in / takeaway can be placed without signing in.
// Delivery requires a signed-in user (enforced in the controller).
router.post('/', orderLimiter, optionalAuth, ctrl.validators.create, validate, ctrl.createOrder);
// Viewing a single order works for guests too (the unguessable id is the
// credential for guest orders); ownership is checked in the controller.
router.get('/:id', optionalAuth, ctrl.getOrder);

router.get('/', requireAuth, ctrl.listMyOrders);
router.patch('/:id/status', requireAuth, requireRole('admin'), ctrl.updateOrderStatus);

module.exports = router;
