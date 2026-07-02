const env = require('./config/env');
const app = require('./app');
const { connectDB } = require('./config/db');
const { findProdConfigProblems } = require('./config/assertProdConfig');
const { isConfigured: firebaseConfigured } = require('./services/firebase.service');
const razorpayService = require('./services/razorpay.service');
const stripeService = require('./services/stripe.service');

// Refuse to boot with insecure defaults in production (shared with the Vercel
// entry point — see config/assertProdConfig.js).
const problems = findProdConfigProblems();
if (problems.length) {
  console.error('\n✋ Refusing to start in production with insecure configuration:');
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

// Start listening immediately so the API is responsive even while MongoDB is
// still connecting (DB-backed routes return 503 until the connection is ready).
app.listen(env.port, () => {
  console.log(`\n🧁  Bakery & Café API running at http://localhost:${env.port}`);
  console.log(`    Environment : ${env.nodeEnv}`);
  console.log(`    Client URL  : ${env.clientUrl}`);
  // Same predicates as routing/health — a lone keyId must not read as "live".
  console.log(`    Payments    : ${razorpayService.isEnabled() ? 'Razorpay (live keys)' : stripeService.isEnabled() ? 'Stripe (live keys)' : 'MOCK mode (no provider keys)'}`);
  console.log(`    Google OAuth: ${env.google.clientId ? 'configured' : 'not configured'}`);
  console.log(`    Phone (Firebase): ${firebaseConfigured() ? 'configured' : `not configured (mock OTP: ${env.otp.provider})`}`);
});

connectDB();

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
