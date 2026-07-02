const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');

// Guards database-backed routes when MongoDB is not connected, returning a
// clear 503 instead of letting queries hang.
module.exports = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return next(
      new ApiError(503, 'Database unavailable. Ensure MongoDB is running and MONGODB_URI is set in server/.env.'),
    );
  }
  next();
};
