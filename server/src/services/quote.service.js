// Compare the summary accepted by the customer with fresh server pricing.
// Submitted amounts are never used to calculate or store an order.
function quoteMatches(expected, items, pricing) {
  if (!expected || !Array.isArray(expected.items) || !expected.pricing) return false;
  const lines = (rows) => rows.map((i) => [String(i.product), i.quantity, i.price])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const fields = ['subtotal', 'discount', 'couponCode', 'tax', 'deliveryFee', 'total', 'currency', 'taxRate'];
  return JSON.stringify(lines(expected.items)) === JSON.stringify(lines(items)) &&
    fields.every((key) => expected.pricing[key] === pricing[key]);
}

module.exports = { quoteMatches };
