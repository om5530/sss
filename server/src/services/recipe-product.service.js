const Recipe = require('../models/BakeryRecipe');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const E = require('./bakeryCost.service');
const { maps } = require('./bakery-context.service');

const sellableRecipe = (r) => r.isActive !== false && r.status === 'active' && !r.isSubRecipe;
function recipePrice(recipe, context) {
  const result = E.evaluateRecipeCost(recipe, context.materials, context.recipes);
  const sellingPrice = E.dec(result.sellingPricePerPiece).toDecimalPlaces(2).toNumber();
  if (sellingPrice <= 0) throw ApiError.badRequest('Recipe selling price must be greater than zero');
  const cost = E.dec(result.costPerPiece);
  return {
    recipeId: String(recipe._id), recipeName: recipe.name, version: recipe.version,
    unitCost: cost.toString(), sellingPrice, piecesPerBatch: Number(result.piecesPerBatch),
    markupPercent: Number(recipe.targetMarkupPercent),
    marginPercent: new E.Decimal(result.actualMarginPercent).toDecimalPlaces(2).toNumber(),
  };
}
async function linkedCosts(productIds, session) {
  if (!productIds.length) return new Map();
  const linked = await Recipe.find({ productId: { $in: productIds } }).session(session || null).lean();
  if (!linked.length) return new Map();
  const context = await maps(session, new Date(), undefined, true, false);
  const result = new Map();
  for (const recipe of linked) {
    const key = String(recipe.productId);
    if (result.has(key)) {
      result.set(key, { error: 'Multiple recipes are linked. Choose one in Product mapping.' });
      continue;
    }
    try {
      if (!sellableRecipe(recipe)) throw ApiError.badRequest('The linked recipe is inactive or is a sub-recipe. Choose an active recipe in Product mapping.');
      result.set(key, recipePrice(recipe, context));
    } catch (err) { result.set(key, { error: err.message }); }
  }
  return result;
}
async function priceProducts(products, { strict = false } = {}) {
  const costs = await linkedCosts(products.map((p) => p._id));
  return products.map((p) => {
    const product = p.toObject ? p.toObject() : { ...p };
    const linked = costs.get(String(p._id));
    if (!linked) return product;
    if (linked.error) {
      if (strict) throw ApiError.conflict(`"${p.name}": ${linked.error}`);
      return { ...product, available: false, pricingError: linked.error, recipeLinked: true };
    }
    return { ...product, price: linked.sellingPrice, recipeLinked: true };
  });
}
async function setProductMapping({ productId, recipeId, expectedRecipeId, expectedVersion, expectedUpdatedAt }, session) {
  const product = await Product.findById(productId).session(session);
  if (!product || product.archived) throw ApiError.notFound('Active product not found');
  if (expectedUpdatedAt && product.updatedAt.toISOString() !== expectedUpdatedAt) throw ApiError.conflict('Product changed. Reload before saving.');
  const previous = await Recipe.find({ productId }).session(session);
  if (previous.length > 1) throw ApiError.conflict('Multiple recipes are linked to this product. Resolve the duplicate links first.');
  if (expectedRecipeId !== undefined && (previous[0] ? String(previous[0]._id) : null) !== expectedRecipeId) throw ApiError.conflict('Mapping changed. Reload before saving.');
  let recipe, price;
  if (!recipeId && previous[0] && sellableRecipe(previous[0])) {
    try { product.price = recipePrice(previous[0], await maps(session, new Date(), undefined, true, false)).sellingPrice; }
    catch { /* Keep the stored price if a broken recipe is being unlinked. */ }
  }
  if (recipeId) {
    recipe = await Recipe.findById(recipeId).session(session);
    if (!recipe || !sellableRecipe(recipe)) throw ApiError.badRequest('Choose an active finished-product recipe');
    if (recipe.productId && String(recipe.productId) !== String(productId)) throw ApiError.conflict('This recipe is already linked to another product');
    if (expectedVersion !== undefined && recipe.version !== expectedVersion) throw ApiError.conflict('Recipe changed. Reload before saving.');
    price = recipePrice(recipe, await maps(session, new Date(), undefined, true, false));
  }
  for (const old of previous) if (!recipe || String(old._id) !== String(recipe._id)) {
    old.productId = null;
    await old.save({ session });
  }
  if (recipe) {
    recipe.productId = product._id;
    await recipe.save({ session });
    product.price = price.sellingPrice;
  }
  // Touch the product on unlink too, to invalidate stale product editors.
  product.markModified('price');
  await product.save({ session });
  return { product, recipe, price };
}
module.exports = { sellableRecipe, recipePrice, linkedCosts, priceProducts, setProductMapping };
