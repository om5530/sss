const express = require('express');
const ctrl = require('../controllers/contact.controller');
const validate = require('../middleware/validate');
const { contactLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Public, anonymous — throttled hard so the form can't be used as a spam pump.
router.post('/', contactLimiter, ctrl.validators.submit, validate, ctrl.submitMessage);

module.exports = router;
