const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: String, // SHA-256 of the signed token; never store the credential itself.
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastActiveAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('AdminSession', schema);
