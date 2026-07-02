const rateLimit = require('express-rate-limit');

// Shared per-IP throttles for the endpoints an anonymous visitor can hammer.
// Signed-in admin traffic never passes through these routers.
const limiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

module.exports = {
  // Sending codes costs money/SMS quota — keep the existing tight budget.
  otpRequestLimiter: limiter({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: 'Too many OTP requests. Please try again later.',
  }),
  // Each code already locks after 5 wrong tries; this stops brute force
  // across many codes/phones from one address.
  otpVerifyLimiter: limiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Too many verification attempts. Please try again later.',
  }),
  orderLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many orders from this device — please wait a few minutes.',
  }),
  paymentLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many payment attempts. Please try again shortly.',
  }),
  contactLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many messages sent — please try again in a little while.',
  }),
  cakeLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many cake requests — please try again in a little while.',
  }),
  uploadLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many uploads — please try again in a little while.',
  }),
  reviewLimiter: limiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many reviews — please slow down.',
  }),
};
