const ApiError = require('../utils/ApiError');
const { verifyToken } = require('../services/token.service');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  try {
    let token;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) throw ApiError.unauthorized();

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) throw ApiError.unauthorized('Account no longer exists');

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Invalid or expired session'));
    }
    next(err);
  }
}

// Like requireAuth, but never rejects: if a valid token is present it sets
// req.user, otherwise the request continues as a guest. Used by routes that
// support guest checkout (dine-in / takeaway).
async function optionalAuth(req, res, next) {
  try {
    let token;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (token) {
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub);
      if (user) req.user = user;
    }
  } catch {
    // Ignore invalid/expired tokens — treat the caller as a guest.
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden());
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole };
