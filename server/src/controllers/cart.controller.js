const asyncHandler = require('../utils/asyncHandler');
const { priceCart } = require('../services/pricing.service');

// The cart lives on the client; this endpoint re-prices and validates it on the
// server so the displayed totals always match authoritative product data.
const priceCartHandler = asyncHandler(async (req, res) => {
  const { items, orderType, couponCode } = req.body;
  const { items: pricedItems, pricing } = await priceCart(items, { orderType, couponCode });
  res.json({ success: true, items: pricedItems, pricing });
});

module.exports = { priceCartHandler };
