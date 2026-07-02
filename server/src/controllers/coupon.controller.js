const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Coupon = require('../models/Coupon');
const { audit } = require('../services/audit.service');

/* ============ Admin CRUD for promo codes ============ */

const listCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json({ success: true, coupons });
});

const createCoupon = asyncHandler(async (req, res) => {
  const { code, type, value, minSubtotal, maxDiscount, expiresAt, usageLimit } = req.body;

  if (type === 'percent' && value > 100) throw ApiError.badRequest('A percent discount cannot exceed 100');

  const coupon = await Coupon.create({
    code,
    type,
    value,
    minSubtotal: minSubtotal || 0,
    maxDiscount: maxDiscount ?? null,
    expiresAt: expiresAt || null,
    usageLimit: usageLimit ?? null,
  });

  audit(req, {
    action: 'coupon.create',
    entity: 'coupon',
    entityId: coupon._id,
    summary: `Created coupon ${coupon.code} (${coupon.type === 'percent' ? `${coupon.value}%` : `₹${coupon.value}`})`,
    after: { code: coupon.code, type: coupon.type, value: coupon.value },
  });

  res.status(201).json({ success: true, coupon });
});

const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');

  const before = { active: coupon.active };
  if (req.body.active !== undefined) coupon.active = Boolean(req.body.active);
  await coupon.save();

  if (before.active !== coupon.active) {
    audit(req, {
      action: coupon.active ? 'coupon.enable' : 'coupon.disable',
      entity: 'coupon',
      entityId: coupon._id,
      summary: `${coupon.active ? 'Enabled' : 'Disabled'} coupon ${coupon.code}`,
      before,
      after: { active: coupon.active },
    });
  }

  res.json({ success: true, coupon });
});

const validators = {
  create: [
    body('code').trim().notEmpty().withMessage('A code is required').isLength({ max: 24 }).withMessage('Code is too long (24 chars max)').matches(/^[A-Za-z0-9-]+$/).withMessage('Letters, numbers and dashes only'),
    body('type').isIn(['percent', 'flat']).withMessage('Type must be percent or flat'),
    body('value').isFloat({ min: 0.01 }).withMessage('Value must be greater than 0'),
    body('minSubtotal').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('maxDiscount').optional({ values: 'null' }).custom((v) => v === null || Number(v) > 0).withMessage('Max discount must be greater than 0'),
    body('expiresAt').optional({ values: 'falsy' }).isISO8601().withMessage('Expiry must be a valid date'),
    body('usageLimit').optional({ values: 'null' }).custom((v) => v === null || (Number.isInteger(v) && v > 0)).withMessage('Usage limit must be a whole number above 0'),
  ],
};

module.exports = { listCoupons, createCoupon, updateCoupon, validators };
