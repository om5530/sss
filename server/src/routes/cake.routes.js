const express = require('express');
const ctrl = require('../controllers/cake.controller');
const uploadCtrl = require('../controllers/upload.controller');
const validate = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { cakeLimiter, uploadLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Public, guest-friendly — throttled hard like the contact form.
router.post('/', cakeLimiter, optionalAuth, ctrl.validators.submit, validate, ctrl.submitRequest);
// Reference-photo upload for the brief (5 MB, images only, tight per-IP limit).
router.post('/reference-image', uploadLimiter, uploadCtrl.acceptImage, uploadCtrl.uploadCakeReference);

module.exports = router;
