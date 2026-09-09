const express = require('express');
const ctrl = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimiters');

const router = express.Router();
router.get('/phone-config', (req, res) => {
  const env = require('../config/env');
  const ready = require('../services/firebase.service').isConfigured();
  const fbConfig = {
    apiKey: env.firebase.apiKey || (env.isProd ? 'AIzaSyC_Apc-tNlP6fxefBi-FGSfyc17Z0mcCOE' : ''),
    authDomain: env.firebase.authDomain || (env.isProd ? 'ssss-ade3d.firebaseapp.com' : ''),
    projectId: env.firebase.projectId || (env.isProd ? 'ssss-ade3d' : ''),
    appId: env.firebase.appId || (env.isProd ? '1:446405901962:web:a365bc2c68f90353a3b773' : ''),
  };
  const mode = ready || (env.isProd && fbConfig.apiKey) ? 'firebase' : (!env.isProd && env.otp.provider === 'mock' ? 'mock' : 'disabled');
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, mode, firebase: mode === 'firebase' ? fbConfig : undefined });
});

router.post('/google', ctrl.googleLogin);
router.post('/firebase-phone', otpVerifyLimiter, ctrl.firebasePhoneLogin);
router.post('/otp/request', otpRequestLimiter, ctrl.validators.requestOtp, validate, ctrl.requestOtp);
router.post('/otp/verify', otpVerifyLimiter, ctrl.validators.verifyOtp, validate, ctrl.verifyOtpLogin);

router.get('/me', requireAuth, ctrl.me);
router.post('/activity', requireAuth, ctrl.activity);
router.patch('/me', requireAuth, ctrl.validators.profile, validate, ctrl.updateProfile);
router.post('/logout', requireAuth, ctrl.logout);

router.post('/addresses', requireAuth, ctrl.validators.address, validate, ctrl.addAddress);
router.patch('/addresses/:addressId', requireAuth, ctrl.validators.address, validate, ctrl.updateAddress);
router.delete('/addresses/:addressId', requireAuth, ctrl.deleteAddress);

module.exports = router;
