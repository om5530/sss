const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  from: String, to: String, subject: String, html: String,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  firstAttemptAt: Date, leaseUntil: Date, lease: String,
  lastError: String, sentAt: Date,
  purgeAt: Date,
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('Notification', schema);
