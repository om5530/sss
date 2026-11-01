const Movement = require('../models/SaasStockMovement');
const { recordMovement, stockReady } = require('../saas/stock-movement');
const { requireCapacity } = require('../saas/usage-limits');
const Product = require('../models/SaasProduct');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');

const { productFields: FIELDS, parseProductInput: bodyOf } = require('../saas/product-input');
const objectId = /^[a-f0-9]{24}$/i;
function view(product) {
  return Object.fromEntries(['_id', ...FIELDS, 'recipeId', 'recipeRevisionId', 'version', 'createdAt', 'updatedAt'].map(key => [key, product[key]]));
}
function productId(req) {
  if (!objectId.test(req.params.productId || '')) throw ApiError.notFound('Product not found');
  return req.params.productId;
}
async function duplicateSafe(write) {
  try { return await write(); }
  catch (error) {
    if (error.code === 11000) throw ApiError.conflict('This product slug is already used in this bakery');
    throw error;
  }
}

const list = asyncHandler(async (req, res) => {
  if (Object.keys(req.query).some(key => !['limit', 'cursor', 'search', 'archived'].includes(key))) throw ApiError.badRequest('Unexpected product filters');
  const { limit = '20', cursor, search = '', archived = 'active' } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !objectId.test(cursor)))
    || typeof search !== 'string' || search.length > 100 || !['active', 'archived', 'all'].includes(archived)) {
    throw ApiError.badRequest('Invalid product filters');
  }
  const filter = { bakeryId: req.bakeryContext.bakeryId };
  if (archived !== 'all') filter.archived = archived === 'archived';
  if (cursor) filter._id = { $lt: cursor };
  if (search.trim()) filter.name = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const products = await Product.find(filter).sort({ _id: -1 }).limit(+limit + 1).lean();
  const hasMore = products.length > +limit;
  if (hasMore) products.pop();
  res.json({ success: true, products: products.map(view), nextCursor: hasMore ? String(products.at(-1)._id) : null });
});
const get = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: productId(req), bakeryId: req.bakeryContext.bakeryId }).lean();
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ success: true, product: view(product) });
});
const create = asyncHandler(async (req, res) => {
  const data = bodyOf(req.body);
  await Promise.all([Product.init(), stockReady(), auditReady()]);
  const product = await duplicateSafe(() => ownerWrite(req.bakeryContext, async session => {
    await requireCapacity(Product, req.bakeryContext.bakeryId, 'products', session);
    const [created] = await Product.create([{ ...data, bakeryId: req.bakeryContext.bakeryId }], { session });
    if (created.stockCount !== null) await recordMovement(session, req.bakeryContext, { productId: created._id, kind: 'opening', before: null, after: created.stockCount, productVersion: created.version });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action: 'product.create', entityId: created._id,
      fromVersion: 0, toVersion: 1, fields: Object.keys(data) });
    return created;
  }));
  res.status(201).json({ success: true, product: view(product) });
});
const update = asyncHandler(async (req, res) => {
  const id = productId(req), data = bodyOf(req.body, true);
  await Promise.all([auditReady(), stockReady()]);
  const product = await duplicateSafe(() => ownerWrite(req.bakeryContext, async session => {
    const before = await Product.findOne({ _id: id, bakeryId: req.bakeryContext.bakeryId }).session(session).lean();
    const countTouched = Object.hasOwn(data, 'stockCount') && before && (data.stockCount !== before.stockCount || req.body.stockCountConfirmed === true);
    const stockUpdate = countTouched ? { stockEpoch: (before.stockEpoch || 1) + 1 } : {};
    const changed = await Product.findOneAndUpdate({ _id: id, bakeryId: req.bakeryContext.bakeryId, version: req.body.expectedVersion },
      { $set: { ...data, ...stockUpdate }, $inc: { version: 1 } }, { session, new: true, runValidators: true });
    if (!changed) {
      if (!await Product.exists({ _id: id, bakeryId: req.bakeryContext.bakeryId }).session(session)) throw ApiError.notFound('Product not found');
      throw ApiError.conflict('This product changed. Reload it before saving');
    }
    if (countTouched) await recordMovement(session, req.bakeryContext, {
      productId: changed._id, kind: before.stockCount === null || changed.stockCount === null ? 'tracking' : 'adjustment',
      before: before.stockCount, after: changed.stockCount, productVersion: changed.version });
    await recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id,
      action: Object.hasOwn(data, 'archived') ? data.archived ? 'product.archive' : 'product.restore' : 'product.update',
      entityId: changed._id, fromVersion: req.body.expectedVersion, toVersion: changed.version, fields: Object.keys(data) });
    return changed;
  }));
  res.json({ success: true, product: view(product) });
});
const stockHistory = asyncHandler(async (req, res) => {
  if (Object.keys(req.query).some(key => !['limit', 'cursor'].includes(key))) throw ApiError.badRequest('Unexpected stock history filters');
  const { limit = '30', cursor } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !objectId.test(cursor)))) throw ApiError.badRequest('Invalid stock history pagination');
  const id = productId(req), bakeryId = req.bakeryContext.bakeryId;
  if (!await Product.exists({ _id: id, bakeryId })) throw ApiError.notFound('Product not found');
  const rows = await Movement.find({ bakeryId, productId: id, ...(cursor ? { _id: { $lt: cursor } } : {}) }).sort({ _id: -1 }).limit(+limit + 1).lean();
  const more = rows.length > +limit; if (more) rows.pop();
  res.json({ success: true, entries: rows.map(row => Object.fromEntries(['_id', 'kind', 'before', 'after', 'delta', 'productVersion', 'orderId', 'productionRunId', 'wasteId', 'createdAt'].map(key => [key, row[key]]))), nextCursor: more ? String(rows.at(-1)._id) : null });
});
module.exports = { list, get, create, update, stockHistory };
