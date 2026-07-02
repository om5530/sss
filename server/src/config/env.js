const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const toNumber = (value, fallback) =>
  value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value);

const nodeEnv = process.env.NODE_ENV || 'development';

const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: toNumber(process.env.PORT, 4000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:4200',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bakery_cafe',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Env stores the PEM with literal "\n"; restore real newlines for the SDK.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  notify: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.NOTIFY_FROM || 'Sweet Savory Savor <onboarding@resend.dev>',
    shopEmail: process.env.SHOP_EMAIL || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  },
  otp: {
    provider: process.env.OTP_PROVIDER || 'mock',
    ttlSeconds: toNumber(process.env.OTP_TTL_SECONDS, 300),
    length: toNumber(process.env.OTP_LENGTH, 6),
    resendCooldownSeconds: toNumber(process.env.OTP_RESEND_COOLDOWN, 30),
  },
  pricing: {
    taxRate: toNumber(process.env.TAX_RATE, 0.05),
    deliveryFee: toNumber(process.env.DELIVERY_FEE, 40),
    currency: (process.env.CURRENCY || 'inr').toLowerCase(),
  },
};

module.exports = env;
