const Product = require('../models/Product');

const prepared = (item) => item?.batches.reduce((total, batch) => total + batch.quantity, 0) || 0;

// Apply preparation changes, not whole totals: sales and an explicit daily reset
// must not be undone by saving expenses or other unchanged event details.
async function syncPreparedStock(previous, plan, stock, session) {
  const before = new Map((previous?.items || []).map((item) => [String(item.product), item]));
  const after = new Map(plan.items.map((item) => [String(item.product), item]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), next = after.get(id);
    const row = stock.find((item) => item.productId === id);
    const consumed = (row?.sold || 0) + (row?.unpaidHandovers || 0) + (row?.refundedHandovers || 0);
    let delta = prepared(next) - prepared(old);
    // Setting up an event after its first sales adds only the unsold pieces.
    if (!old && next) delta -= consumed - (next.returned || 0);
    // Removing a product removes its remaining preparation, not pieces sold.
    if (old && !next) delta += consumed - (old.returned || 0);
    if (!delta) continue;
    const product = await Product.findById(id).session(session);
    if (!product) continue;
    product.stockCount = Math.max(0, (product.stockCount ?? 0) + delta);
    if (product.stockCount > 0 && product.stockSoldOut && !product.archived) {
      product.available = true;
      product.stockSoldOut = false;
    } else if (product.stockCount === 0 && product.available) {
      product.available = false;
      product.stockSoldOut = true;
    }
    await product.save({ session });
  }
}

module.exports = { syncPreparedStock };
