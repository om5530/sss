const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const client = env.google.clientId ? new OAuth2Client(env.google.clientId) : null;

async function verifyGoogleIdToken(idToken) {
  if (!client) {
    throw ApiError.badRequest('Google login is not configured. Set GOOGLE_CLIENT_ID in server/.env.');
  }

  const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
  const payload = ticket.getPayload();

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    avatar: payload.picture,
    emailVerified: payload.email_verified,
  };
}

module.exports = { verifyGoogleIdToken, isConfigured: () => Boolean(client) };
