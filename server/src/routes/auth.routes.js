const express = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/google', ctrl.googleLogin);
router.post('/firebase-phone', ctrl.firebasePhoneLogin);
router.post('/otp/request', otpRequestLimiter, ctrl.validators.requestOtp, validate, ctrl.requestOtp);
router.post('/otp/verify', otpVerifyLimiter, ctrl.validators.verifyOtp, validate, ctrl.verifyOtpLogin);

router.get('/me', requireAuth, ctrl.me);
router.patch('/me', requireAuth, ctrl.updateProfile);
router.post('/logout', requireAuth, ctrl.logout);

router.post('/addresses', requireAuth, ctrl.validators.address, validate, ctrl.addAddress);
router.patch('/addresses/:addressId', requireAuth, ctrl.updateAddress);
router.delete('/addresses/:addressId', requireAuth, ctrl.deleteAddress);

module.exports = router;
