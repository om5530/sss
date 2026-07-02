const express = require('express');
const ctrl = require('../controllers/cart.controller');

const router = express.Router();

router.post('/price', ctrl.priceCartHandler);

module.exports = router;
