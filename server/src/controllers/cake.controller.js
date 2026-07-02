const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const CakeRequest = require('../models/CakeRequest');
const { audit } = require('../services/audit.service');
const { notifyCakeRequest } = require('../services/notify.service');

/* ============ Public ============ */

const submitRequest = asyncHandler(async (req, res) => {
  const { name, phone, email, occasion, servings, flavour, messageOnCake, dateNeeded, details, referenceImage } = req.body;

  const when = new Date(dateNeeded);
  // At least a day's notice — compared at UTC calendar-day granularity, because
  // the form submits a date-only string ("yyyy-mm-dd" parses as UTC midnight)
  // and the picker's own minimum must be accepted, not rejected by hours.
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
  cutoff.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(when.getTime()) || when < cutoff) {
    throw ApiError.badRequest('Custom cakes need at least a day’s notice — pick a later date');
  }

  const request = await CakeRequest.create({
    user: req.user ? req.user._id : null,
    name,
    phone,
    email: email || '',
    occasion,
    servings,
    flavour,
    messageOnCake: messageOnCake || '',
    dateNeeded: when,
    details: details || '',
    referenceImage: referenceImage || '',
  });

  notifyCakeRequest(request);

  res.status(201).json({ success: true, request: { _id: request._id, status: request.status } });
});

/* ============ Admin ============ */

function parsePagination(query, defaultLimit = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

const REQUEST_STATUSES = ['new', 'quoted', 'accepted', 'declined', 'closed'];

const listRequests = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (typeof status === 'string' && REQUEST_STATUSES.includes(status)) filter.status = status;

  const [requests, total, newCount] = await Promise.all([
    CakeRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name phone email'),
    CakeRequest.countDocuments(filter),
    CakeRequest.countDocuments({ status: 'new' }),
  ]);

  res.json({ success: true, requests, total, newCount, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

const updateRequest = asyncHandler(async (req, res) => {
  const request = await CakeRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Cake request not found');

  const { status, quoteAmount, quoteNote } = req.body;
  const previous = request.status;

  if (status !== undefined) request.status = status;
  if (quoteAmount !== undefined) request.quote.amount = quoteAmount === null ? null : Number(quoteAmount);
  if (quoteNote !== undefined) request.quote.note = String(quoteNote || '');
  await request.save();

  if (status && status !== previous) {
    audit(req, {
      action: 'cake.status',
      entity: 'cake-request',
      entityId: request._id,
      summary: `Cake request from ${request.name} (${request.occasion}): ${previous} → ${status}${request.quote.amount ? ` · quoted ₹${request.quote.amount}` : ''}`,
      before: { status: previous },
      after: { status },
    });
  }

  res.json({ success: true, request });
});

const validators = {
  submit: [
    body('name').trim().notEmpty().withMessage('Please tell us your name').isLength({ max: 100 }),
    body('phone').trim().notEmpty().withMessage('We need a phone number to call you back').isLength({ max: 20 }),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Please enter a valid email').isLength({ max: 254 }),
    body('occasion').trim().notEmpty().withMessage('What’s the occasion?').isLength({ max: 60 }),
    body('servings').isInt({ min: 1, max: 500 }).withMessage('How many people should it serve?'),
    body('flavour').trim().notEmpty().withMessage('Pick a flavour (or say “baker’s choice”)').isLength({ max: 80 }),
    body('messageOnCake').optional({ values: 'falsy' }).trim().isLength({ max: 120 }).withMessage('Cake messages fit 120 characters'),
    body('dateNeeded').notEmpty().withMessage('When do you need it?').isISO8601().withMessage('Pick a valid date'),
    body('details').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('referenceImage').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  ],
  update: [
    body('status').optional().isIn(REQUEST_STATUSES).withMessage('Choose a valid status'),
    body('quoteAmount').optional({ values: 'null' }).custom((v) => v === null || Number(v) >= 0).withMessage('Quote must be 0 or more'),
    body('quoteNote').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  ],
};

module.exports = { submitRequest, listRequests, updateRequest, validators };
