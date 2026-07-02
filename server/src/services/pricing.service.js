const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Validates a coupon code against the current subtotal and returns the coupon
 * doc + the discount it grants. Throws friendly 400s for every failure mode so
 * the checkout can show exactly why a code didn't apply.
 */
async function resolveCoupon(couponCode, subtotal) {
  const code = String(couponCode).trim().toUpperCase();
  const coupon = await Coupon.findOne({ code });

  // One generic message for "no such code" / disabled / not started — anything
  // more specific confirms which codes exist to an enumerator. Expired /
  // redeemed / min-subtotal messages stay helpful: they only reach customers
  // holding a genuinely issued code (and /cart/price is rate-limited).
  const invalid = () => ApiError.badRequest('That coupon code isn’t valid');
  if (!coupon || !coupon.active) throw invalid();

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw invalid();
  if (coupon.expiresAt && now > coupon.expiresAt) throw ApiError.badRequest('That coupon has expired');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw ApiError.badRequest('That coupon has been fully redeemed');
  }
  if (subtotal < coupon.minSubtotal) {
    throw ApiError.badRequest(`Add ₹${round2(coupon.minSubtotal - subtotal).toFixed(2)} more to use ${coupon.code}`);
  }

  let discount = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  discount = round2(Math.min(discount, subtotal));

  return { coupon, discount };
}

/**
 * Recomputes a cart on the server from authoritative product data.
 * Client-supplied prices and totals are never trusted (US-3.3 / US-6.1).
 * Tax applies to the discounted subtotal.
 *
 * @param {Array<{productId: string, quantity: number}>} items
 * @param {{ orderType?: string, couponCode?: string }} options
 * @returns items, pricing, and the resolved coupon doc (null when no code).
 */
async function priceCart(items, { orderType, couponCode } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Your cart is empty');
  }

  const ids = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));

  const lineItems = items.map((item) => {
    const product = byId.get(String(item.productId));
    if (!product || product.archived) throw ApiError.badRequest(`Product not found: ${item.productId}`);
    if (!product.available) throw ApiError.conflict(`"${product.name}" is currently unavailable`);

    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
    return {
      product: product._id,
      name: product.name,
      price: product.price,
      quantity,
      lineTotal: round2(product.price * quantity),
    };
  });

  const subtotal = round2(lineItems.reduce((sum, l) => sum + l.lineTotal, 0));

  let coupon = null;
  let discount = 0;
  if (couponCode && String(couponCode).trim()) {
    ({ coupon, discount } = await resolveCoupon(couponCode, subtotal));
  }

  const taxable = round2(subtotal - discount);
  const tax = round2(taxable * env.pricing.taxRate);
  const deliveryFee = orderType === 'delivery' ? env.pricing.deliveryFee : 0;
  const total = round2(taxable + tax + deliveryFee);

  return {
    items: lineItems,
    coupon,
    pricing: {
      subtotal,
      discount,
      couponCode: coupon ? coupon.code : undefined,
      tax,
      deliveryFee,
      total,
      currency: env.pricing.currency,
      taxRate: env.pricing.taxRate,
    },
  };
}

module.exports = { priceCart };
