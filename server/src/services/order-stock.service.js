const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');

// Shared by website checkout and staff-entered orders.
async function claimStock(lineItems) {
  const claimed = [];
  try {
    for (const item of lineItems) {
      const res = await Product.updateOne(
        { _id: item.product, stockCount: { $ne: null, $gte: item.quantity } },
        { $inc: { stockCount: -item.quantity } },
      );
      if (res.matchedCount === 0) {
        const p = await Product.findById(item.product).select('name stockCount');
        if (p && p.stockCount != null) {
          throw ApiError.conflict(p.stockCount > 0
            ? `Only ${p.stockCount} × "${p.name}" left today — please adjust your order`
            : `"${p.name}" just sold out — please remove it from your order`);
        }
        continue;
      }
      claimed.push(item);
      await Product.updateOne({ _id: item.product, stockCount: { $lte: 0 } }, { $set: { available: false } });
    }
    return claimed;
  } catch (err) {
    await releaseStock(claimed);
    throw err;
  }
}

async function releaseStock(lineItems) {
  for (const item of lineItems) {
    const prev = await Product.findOneAndUpdate(
      { _id: item.product, stockCount: { $ne: null } },
      { $inc: { stockCount: item.quantity } },
    ).select('stockCount archived').catch((err) => {
      console.error('[stock] release failed:', err.message);
      return null;
    });
    if (prev && prev.stockCount <= 0 && !prev.archived) {
      await Product.updateOne({ _id: item.product, stockCount: { $gt: 0 } }, { $set: { available: true } }).catch(() => {});
    }
  }
}

module.exports = { claimStock, releaseStock };
