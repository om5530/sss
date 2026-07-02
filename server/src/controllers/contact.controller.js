const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ContactMessage = require('../models/ContactMessage');
const { audit } = require('../services/audit.service');
const { notifyEnquiry } = require('../services/notify.service');

/* ============ Public ============ */

const submitMessage = asyncHandler(async (req, res) => {
  const { name, email, message } = req.body;
  const saved = await ContactMessage.create({ name, email, message });

  // Fire-and-forget shop alert (logs in dev when no email key is set).
  notifyEnquiry(saved);

  res.status(201).json({ success: true });
});

/* ============ Admin ============ */

function parsePagination(query, defaultLimit = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

const MESSAGE_STATUSES = ['new', 'read', 'closed'];

const listMessages = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  // Enum-check rather than pass through — query params can carry operator objects.
  if (typeof status === 'string' && MESSAGE_STATUSES.includes(status)) filter.status = status;

  const [messages, total, newCount] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ status: 'new' }),
  ]);

  res.json({ success: true, messages, total, newCount, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const updateMessageStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const message = await ContactMessage.findById(req.params.id);
  if (!message) throw ApiError.notFound('Message not found');

  const previous = message.status;
  message.status = status;
  await message.save();

  if (status === 'closed') {
    audit(req, {
      action: 'enquiry.close',
      entity: 'enquiry',
      entityId: message._id,
      summary: `Closed enquiry from ${message.name} <${message.email}>`,
      before: { status: previous },
      after: { status },
    });
  }

  res.json({ success: true, message });
});

/* ============ Validators ============ */

const validators = {
  submit: [
    body('name').trim().notEmpty().withMessage('Please tell us your name').isLength({ max: 100 }).withMessage('Name is too long'),
    body('email').trim().isEmail().withMessage('Please enter a valid email').isLength({ max: 254 }),
    body('message').trim().notEmpty().withMessage('Please write a message').isLength({ max: 2000 }).withMessage('Message is too long (2000 characters max)'),
  ],
  updateStatus: [body('status').isIn(['new', 'read', 'closed']).withMessage('Choose a valid status')],
};

module.exports = { submitMessage, listMessages, updateMessageStatus, validators };
