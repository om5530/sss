const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Order = require('../models/Order');

const listProducts = asyncHandler(async (req, res) => {
  const { group, category, q, available, featured } = req.query;
  // Archived products never appear on the storefront (AS-4.5).
  const filter = { archived: { $ne: true } };
  if (group) filter.group = group;
  if (category) filter.category = category;
  if (available !== undefined) filter.available = available === 'true';
  if (featured !== undefined) filter.featured = featured === 'true';
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ];
  }

  const products = await Product.find(filter).sort({ group: 1, category: 1, name: 1 });
  res.json({ success: true, count: products.length, products });
});

const getMenu = asyncHandler(async (req, res) => {
  const products = await Product.find({ available: true, archived: { $ne: true } }).sort({ name: 1 });

  // Shape: { bakery: { Brownies: [...] }, savoury: { Pizza: [...] } }
  const menu = {};
  for (const p of products) {
    menu[p.group] = menu[p.group] || {};
    menu[p.group][p.category] = menu[p.group][p.category] || [];
    menu[p.group][p.category].push(p);
  }
  res.json({ success: true, menu });
});

const getCategories = asyncHandler(async (req, res) => {
  const rows = await Product.aggregate([
    { $match: { archived: { $ne: true } } },
    { $group: { _id: { group: '$group', category: '$category' }, count: { $sum: 1 } } },
    { $sort: { '_id.group': 1, '_id.category': 1 } },
  ]);
  const categories = rows.map((r) => ({ group: r._id.group, category: r._id.category, count: r.count }));
  res.json({ success: true, categories });
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, archived: { $ne: true } });
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ success: true, product });
});

/* ============ Reviews (verified purchase only) ============ */

/** True when the user has a completed order containing the product. */
function hasPurchased(userId, productId) {
  return Order.exists({ user: userId, orderStatus: 'completed', 'items.product': productId });
}

/** Recomputes the denormalised rating stats after any review write. */
async function refreshRatingStats(productId) {
  const [stats] = await Review.aggregate([
    { $match: { product: productId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: productId },
    { $set: { ratingAvg: stats ? Math.round(stats.avg * 10) / 10 : 0, ratingCount: stats ? stats.count : 0 } },
  );
}

// Public list; when signed in it also says whether YOU can review and what you
// already wrote, so the UI needs no second round-trip.
const listReviews = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, archived: { $ne: true } }).select('_id');
  if (!product) throw ApiError.notFound('Product not found');

  const reviews = await Review.find({ product: product._id }).sort({ createdAt: -1 }).limit(50);

  let eligible = false;
  let myReview = null;
  if (req.user) {
    [eligible, myReview] = await Promise.all([
      hasPurchased(req.user._id, product._id).then(Boolean),
      Review.findOne({ product: product._id, user: req.user._id }),
    ]);
  }

  res.json({ success: true, reviews, eligible, myReview });
});

// One review per customer per product, upserted so they can edit their take.
const upsertReview = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, archived: { $ne: true } }).select('_id');
  if (!product) throw ApiError.notFound('Product not found');

  if (!(await hasPurchased(req.user._id, product._id))) {
    throw ApiError.forbidden('Reviews are for verified purchases — order this item first, then tell us how it was');
  }

  const { rating, text } = req.body;
  const review = await Review.findOneAndUpdate(
    { product: product._id, user: req.user._id },
    {
      product: product._id,
      user: req.user._id,
      authorName: req.user.name || 'A customer',
      rating,
      text: (text || '').trim(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await refreshRatingStats(product._id);

  res.status(201).json({ success: true, review });
});

const reviewValidators = {
  upsert: [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1 to 5 stars'),
    body('text').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }).withMessage('Reviews fit 1000 characters'),
  ],
};

module.exports = { listProducts, getMenu, getCategories, getProduct, listReviews, upsertReview, reviewValidators };
