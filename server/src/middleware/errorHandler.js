const ApiError = require('../utils/ApiError');
const env = require('../config/env');

function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  // Normalise common Mongoose errors into ApiError shapes.
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors).map((e) => ({ field: e.path, message: e.message }));
    error = ApiError.badRequest('Validation failed', details);
  } else if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {}).join(', ');
    error = ApiError.conflict(`An account with this ${field} already exists`);
  } else if (error.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${error.path}: ${error.value}`);
  }

  const statusCode = error.statusCode || 500;
  // Database/provider errors can embed the searched name, email or phone.
  const privateSearch = req.path === '/api/admin/customers/search' || req.path === '/api/admin/customers';
  if (statusCode >= 500) {
    console.error('[error]', { requestId: req.requestId, method: req.method, path: req.path },
      privateSearch ? 'Customer search failed' : err);
  }

  res.status(statusCode).json({
    success: false,
    requestId: req.requestId,
    message: statusCode >= 500 && (env.isProd || privateSearch) ? 'Something went wrong. Please try again.' : error.message || 'Internal server error',
    ...(error.details && !(privateSearch && statusCode >= 500) ? { details: error.details } : {}),
    ...(!env.isProd && !privateSearch && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
