const Product = require('../models/Product');
const EventPlan = require('../models/EventPlan');
const asyncHandler = require('../utils/asyncHandler');
const { transaction } = require('../services/bakery-transaction.service');
const { audit } = require('../services/audit.service');

const reset = asyncHandler(async (req, res) => {
  const result = await transaction(async (session) => {
    const products = await Product.updateMany({}, [{ $set: {
      stockCount: 0,
      // Preserve deliberate unavailability, while letting new preparation
      // restore products that this reset made sold out.
      stockSoldOut: { $and: [
        { $ne: ['$archived', true] },
        { $or: [{ $eq: ['$available', true] }, { $eq: ['$stockSoldOut', true] }] },
      ] },
      available: false,
    } }], { session });
    await EventPlan.updateMany({}, { $set: { 'items.$[].stockNeedsRestore': true } }, { session });
    return products;
  });
  audit(req, { action: 'product.stock.reset', entity: 'product',
    summary: `Reset today's stock to 0 for ${result.matchedCount} products`,
    after: { stockCount: 0, products: result.matchedCount } });
  res.json({ success: true, count: result.matchedCount });
});

module.exports = { reset };
