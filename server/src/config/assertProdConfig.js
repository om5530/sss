const env = require('./env');

// Every env var has a dev-friendly fallback, which makes it dangerously easy
// to deploy without real secrets. This shared backstop is called by both entry
// points — server.js (long-running host) and api/index.js (Vercel serverless)
// — so neither can boot in production with insecure defaults
// (see docs/PRE-LAUNCH-CHECKLIST.md).
const KNOWN_DEV_SECRETS = ['dev-secret-change-me', 'dev-only-secret-please-change-in-production'];

function findProdConfigProblems() {
  if (!env.isProd) return [];

  const problems = [];
  if (KNOWN_DEV_SECRETS.includes(env.jwt.secret) || env.jwt.secret.length < 32) {
    problems.push('JWT_SECRET is missing, too short (<32 chars) or a known dev default — anyone could forge admin sessions');
  }
  if (!process.env.MONGODB_URI) problems.push('MONGODB_URI is not set');
  if (/localhost|127\.0\.0\.1/.test(env.clientUrl)) problems.push('CLIENT_URL still points at localhost — CORS/cookies would break for real visitors');
  if (env.stripe.secretKey && !env.stripe.webhookSecret) {
    problems.push('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — customers would be charged but their orders never confirmed (webhook events are ignored without it)');
  }
  if ((env.razorpay.keyId && !env.razorpay.keySecret) || (!env.razorpay.keyId && env.razorpay.keySecret)) {
    problems.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together');
  }
  if (env.razorpay.keyId && env.razorpay.keySecret && !env.razorpay.webhookSecret) {
    problems.push('Razorpay keys are set but RAZORPAY_WEBHOOK_SECRET is missing — a customer who pays and closes the tab before returning would be charged without their order ever confirming');
  }
  // EXPOSE_DEV_OTP returns login codes in API responses (anyone can sign in
  // as any phone number). Tolerable on a demo deployment; never alongside
  // live payment keys, where a forged session can spend real money.
  const hasLivePaymentKeys =
    env.razorpay.keyId.startsWith('rzp_live_') || env.stripe.secretKey.startsWith('sk_live_');
  if (env.otp.exposeDevOtp && hasLivePaymentKeys) {
    problems.push('EXPOSE_DEV_OTP is enabled together with LIVE payment keys — anyone could log in as any customer and place real orders. Remove EXPOSE_DEV_OTP (set up Firebase SMS instead)');
  }
  return problems;
}

module.exports = { findProdConfigProblems };
