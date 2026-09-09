const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { audit } = require('../services/audit.service');
const { getStoreSettings, updateStoreSettings } = require('../services/store-settings.service');

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
  const fields = ['taxRate', 'deliveryFee', 'currency', 'opensAt', 'closesAt', 'contactAddress', 'contactPhone', 'contactEmail'];
  const changes = Object.fromEntries(fields.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  if (!Object.keys(changes).length) throw ApiError.badRequest('Provide at least one setting to update');
  if (changes.currency) changes.currency = String(changes.currency).toLowerCase();
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
];

module.exports = { list, update, validators };
