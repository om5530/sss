const mongoose = require('mongoose');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { maps } = require('../services/bakery-context.service');
const { transaction } = require('../services/bakery-transaction.service');
const { sellableRecipe, recipePrice, setProductMapping } = require('../services/recipe-product.service');
const { audit } = require('../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const [products, context] = await Promise.all([
    Product.find({ archived: { $ne: true } }).sort({ name: 1 }).lean(),
    maps(undefined, new Date(), undefined, true, false),
  ]);
  const recipes = [...context.recipes.values()].filter(sellableRecipe).map((r) => {
    try { return { ...recipePrice(r, context), linkedProductId: r.productId ? String(r.productId) : null }; }
    catch (err) { return { recipeId: String(r._id), recipeName: r.name, version: r.version, revisionFamilyId: String(r.revisionFamilyId || r._id), revisionNumber: r.revisionNumber || 1, revisionLabel: r.revisionLabel || '', linkedProductId: r.productId ? String(r.productId) : null, error: err.message }; }
  }).sort((a, b) => a.recipeName.localeCompare(b.recipeName) || a.revisionFamilyId.localeCompare(b.revisionFamilyId) || a.revisionNumber - b.revisionNumber);
  res.json({ success: true, recipes, products: products.map((p) => {
    const linked = [...context.recipes.values()].filter((r) => r.productId && String(r.productId) === String(p._id));
    const price = recipes.find((r) => r.recipeId === String(linked[0]?._id));
    const error = linked.length > 1 ? 'Multiple recipes are linked' : linked.length && !price ? 'The linked recipe is unavailable' : price?.error;
    return { _id: p._id, name: p.name, category: p.category, updatedAt: p.updatedAt, price: price?.sellingPrice ?? p.price,
      recipeId: linked[0] ? String(linked[0]._id) : null, recipeName: linked[0]?.name || '', error: error || null };
  }) });
});
const save = asyncHandler(async (req, res) => {
  const { recipeId, expectedRecipeId, expectedVersion, expectedUpdatedAt } = req.body;
  if (!mongoose.isValidObjectId(req.params.id) || (recipeId !== null && !mongoose.isValidObjectId(recipeId)) ||
      (expectedRecipeId !== null && !mongoose.isValidObjectId(expectedRecipeId)) ||
      (recipeId && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) ||
      typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw ApiError.badRequest('Invalid mapping. Reload and choose a recipe.');
  }
  const result = await transaction((session) => setProductMapping({ productId: req.params.id, recipeId, expectedRecipeId, expectedVersion, expectedUpdatedAt }, session));
  audit(req, { action: 'product.recipe-link', entity: 'product', entityId: result.product._id,
    summary: result.recipe ? `Linked ${result.product.name} to ${result.recipe.name} (₹${result.price.sellingPrice} per unit)` : `Unlinked recipe from ${result.product.name}`,
    before: { recipeId: expectedRecipeId }, after: { recipeId, price: result.product.price } });
  res.json({ success: true });
});
module.exports = { list, save };
