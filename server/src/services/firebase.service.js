const admin = require('firebase-admin');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function getFirebaseApp() {
  const projectId = env.firebase.projectId || 'ssss-ade3d';
  if (admin.apps.length) return admin.apps[0];
  if (env.firebase.clientEmail && env.firebase.privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey,
      }),
    });
  }
  return admin.initializeApp({ projectId });
}

async function verifyFirebaseIdToken(idToken) {
  const app = getFirebaseApp();

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch {
    throw ApiError.unauthorized('Invalid or expired verification. Please request a new code.');
  }

  return verifiedPhone(decoded);
}

// Called only after Admin SDK signature, project and revocation verification.
function verifiedPhone(decoded) {
  if (!/^\+[1-9]\d{6,14}$/.test(decoded.phone_number || '') || decoded.firebase?.sign_in_provider !== 'phone' ||
      !Number.isFinite(decoded.auth_time) || Date.now() / 1000 - decoded.auth_time > 300 || decoded.auth_time > Date.now() / 1000 + 60) {
    throw ApiError.badRequest('This sign-in did not include a verified phone number.');
  }

  return { firebaseUid: decoded.uid, phone: decoded.phone_number };
}

module.exports = { verifyFirebaseIdToken, verifiedPhone, isConfigured: () => Boolean(process.env.FIREBASE_PROJECT_ID || (env.firebase.clientEmail && env.firebase.privateKey)) };
