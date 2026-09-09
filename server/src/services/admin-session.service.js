const crypto = require('crypto');
const AdminSession = require('../models/AdminSession');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const idleMs = () => env.admin.idleMinutes * 60_000;
const sessionId = (token) => crypto.createHash('sha256').update(token).digest('hex');
const expired = () => ApiError.unauthorized('Your admin session expired after inactivity. Please sign in again.');

async function checkAdminSession(token, user, payload) {
  const id = sessionId(token);
  let session = await AdminSession.findById(id);
  if (!session) {
    // Old tokens cannot obtain a fresh idle window simply by being replayed.
    const issuedAt = new Date(payload.iat * 1000);
    if (!Number.isFinite(issuedAt.getTime()) || issuedAt.getTime() <= Date.now() - idleMs()) throw expired();
    session = await AdminSession.findOneAndUpdate({ _id: id }, {
      $setOnInsert: { user: user._id, lastActiveAt: issuedAt, expiresAt: new Date(payload.exp * 1000) },
    }, { upsert: true, new: true }).catch(async (err) => {
      if (err.code === 11000) return AdminSession.findById(id);
      throw err;
    });
  }
  if (session.lastActiveAt.getTime() <= Date.now() - idleMs() || session.expiresAt <= new Date()) throw expired();
  return { id, idleExpiresAt: new Date(Math.min(session.lastActiveAt.getTime() + idleMs(), session.expiresAt.getTime())) };
}

async function recordActivity(id) {
  const now = new Date();
  const session = await AdminSession.findOneAndUpdate({
    _id: id, lastActiveAt: { $gt: new Date(now.getTime() - idleMs()) }, expiresAt: { $gt: now },
  }, { $set: { lastActiveAt: now } }, { new: true });
  if (!session) throw expired();
  return new Date(Math.min(now.getTime() + idleMs(), session.expiresAt.getTime()));
}

module.exports = { checkAdminSession, recordActivity };
