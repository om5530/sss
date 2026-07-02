const express = require('express');
const ctrl = require('../controllers/product.controller');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { reviewLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/', ctrl.listProducts);
router.get('/menu', ctrl.getMenu);
router.get('/categories', ctrl.getCategories);
// Reviews before /:slug so "reviews" never parses as a slug.
router.get('/:slug/reviews', optionalAuth, ctrl.listReviews);
router.post('/:slug/reviews', reviewLimiter, requireAuth, ctrl.reviewValidators.upsert, validate, ctrl.upsertReview);
router.get('/:slug', ctrl.getProduct);

module.exports = router;
