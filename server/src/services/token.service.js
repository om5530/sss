const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('./../config/env');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, version: user.sessionVersion ?? 0 }, env.jwt.secret, {
    jwtid: crypto.randomUUID(),
    expiresIn: env.jwt.expiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = { signToken, verifyToken };
