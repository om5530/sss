const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Notification = require('../models/Notification');
const { processDue } = require('../services/notification-queue.service');

const dispatch = asyncHandler(async (req, res) => res.json({ success: true, ...await processDue() }));
const summary = asyncHandler(async (req, res) => {
  const counts = await Notification.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const failed = await Notification.find({ status: 'failed' }).select('subject lastError attempts updatedAt').sort({ updatedAt: -1 }).limit(20);
  res.json({ success: true, counts: Object.fromEntries(counts.map((c) => [c._id, c.count])), failed });
});
function requireJobSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const token = req.headers.authorization || '';
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  if (!secret || actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return next(ApiError.unauthorized());
  res.set('Cache-Control', 'no-store');
  next();
}
module.exports = { dispatch, summary, requireJobSecret };
