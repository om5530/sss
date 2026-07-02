const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

// Collects express-validator results and forwards them as a 400 error.
module.exports = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(ApiError.badRequest('Validation failed', details));
  }
  next();
};
