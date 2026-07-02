const admin = require('firebase-admin');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Initialise the Admin SDK only when a full service account is configured.
// Left unconfigured, phone login is simply disabled (mirrors Google login).
const configured = Boolean(
  env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey,
);

const app = configured
  ? admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
    })
  : null;

async function verifyFirebaseIdToken(idToken) {
  if (!app) {
    throw ApiError.badRequest(
      'Phone login is not configured. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in server/.env.',
    );
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired verification. Please request a new code.');
  }

  if (!decoded.phone_number) {
    throw ApiError.badRequest('This sign-in did not include a verified phone number.');
  }

  return { firebaseUid: decoded.uid, phone: decoded.phone_number };
}

module.exports = { verifyFirebaseIdToken, isConfigured: () => Boolean(app) };
