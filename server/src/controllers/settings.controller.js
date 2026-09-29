const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { audit } = require('../services/audit.service');
const { getStoreSettings, updateStoreSettings } = require('../services/store-settings.service');
const { UPI_ID_PATTERN } = require('../config/upi');

function validTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?:[01]?\d|2[0-4]):[0-5]\d$/.test(value);
  if (!match) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 || minute === 0;
}

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, settings: await getStoreSettings() });
});

const update = asyncHandler(async (req, res) => {
  const before = await getStoreSettings();
  const fields = ['taxRate', 'deliveryFee', 'currency', 'opensAt', 'closesAt', 'contactAddress', 'contactPhone', 'contactEmail', 'upiRecipients', 'defaultUpiRecipientId'];
  const changes = Object.fromEntries(fields.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  if (!Object.keys(changes).length) throw ApiError.badRequest('Provide at least one setting to update');
  if (changes.currency) changes.currency = String(changes.currency).toLowerCase();
  const recipients = changes.upiRecipients || before.upiRecipients;
  const defaultId = changes.defaultUpiRecipientId || before.defaultUpiRecipientId;
  if (!recipients.some((r) => r.id === defaultId && UPI_ID_PATTERN.test(r.upiId))) {
    throw ApiError.badRequest('Choose a default recipient with a configured UPI ID');
  }
  if (changes.upiRecipients) changes.upiRecipients = recipients.map(({ id, name, upiId, payeeName }) => ({ id, name, upiId, payeeName }));
  const settings = await updateStoreSettings(changes);
  audit(req, {
    action: 'settings.update', entity: 'settings', entityId: 'store', summary: 'Updated store settings',
    before: Object.fromEntries(fields.map((key) => [key, before[key]])),
    after: Object.fromEntries(fields.map((key) => [key, settings[key]])),
  });
  res.json({ success: true, settings });
});

const validators = [
  body('taxRate').optional().custom((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1).withMessage('Tax rate must be between 0% and 100%'),
  body('deliveryFee').optional().custom((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001).withMessage('Delivery fee must be between 0 and 100000 with up to two decimals'),
  body('currency').optional().isString().bail().trim().toLowerCase().equals('inr').withMessage('This storefront currently supports INR only'),
  body('opensAt').optional().custom(validTime).withMessage('Opening time must be HH:MM between 00:00 and 24:00'),
  body('closesAt').optional().custom(validTime).withMessage('Closing time must be HH:MM between 00:00 and 24:00'),
  body('contactAddress').optional().isString().trim().isLength({ max: 240 }).withMessage('Address must be 240 characters or fewer'),
  body('contactPhone').optional().isString().trim().isLength({ max: 40 }).withMessage('Phone must be 40 characters or fewer'),
  body('contactEmail').optional().isString().bail().trim().isLength({ max: 240 }).bail().if((value) => value !== '').isEmail().withMessage('Enter a valid contact email'),
  body('defaultUpiRecipientId').optional().isIn(['omkar', 'harshita', 'aarchita']).withMessage('Choose a valid default UPI recipient'),
  body('upiRecipients').optional().isArray({ min: 3, max: 3 }).bail().custom((rows) =>
    new Set(rows.map((r) => r?.id)).size === 3 && rows.every((r) => ['omkar', 'harshita', 'aarchita'].includes(r?.id))).withMessage('Configure Omkar, Harshita and Aarchita once each'),
  body('upiRecipients.*.name').isString().bail().trim().isLength({ min: 1, max: 120 }),
  body('upiRecipients.*.payeeName').isString().bail().trim().isLength({ min: 1, max: 120 }),
  body('upiRecipients.*.upiId').isString().bail().trim().custom((v) => v === '' || UPI_ID_PATTERN.test(v)).withMessage('Enter a valid UPI ID or leave it blank until configured'),
];

module.exports = { list, update, validators };
