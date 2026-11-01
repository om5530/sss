const { checkMaterialChange, inventoryReady } = require('../saas/material-inventory');
const { requireCapacity } = require('../saas/usage-limits');
const Material = require('../models/SaasMaterial');
const Recipe = require('../models/SaasRecipe');
const Revision = require('../models/SaasRecipeRevision');
const Product = require('../models/SaasProduct');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ownerWrite } = require('../saas/owner-write');
const { auditReady, recordAudit } = require('../saas/audit');
const { materialInput, revisionInput, costRevision, fields, text, integer } = require('../saas/recipe-input');
const idPattern = /^[a-f0-9]{24}$/i;
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record[key]]));
const materialView = record => pick(record, ['_id', 'name', 'type', 'packQuantity', 'packUom', 'purchasePricePaise', 'active', 'version', 'createdAt', 'updatedAt']);
const recipeView = record => pick(record, ['_id', 'name', 'category', 'archived', 'version', 'latestRevisionNumber', 'createdAt', 'updatedAt']);
const revisionView = record => pick(record, ['_id', 'recipeId', 'revisionNumber', 'yieldPieces', 'label', 'notes', 'overheadPaise', 'ingredients', 'batchCostPaise', 'unitCostPaise', 'createdAt']);
function id(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw ApiError.notFound(`${label} not found`);
  return value;
}
async function ready() { await Promise.all([Material.init(), Recipe.init(), Revision.init(), inventoryReady(), auditReady()]); }
function listFilter(req, kind) {
  fields(req.query, ['limit', 'cursor', 'search', kind]);
  const { limit = '20', cursor, search = '' } = req.query;
  const state = req.query[kind] || 'active';
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (cursor !== undefined && (typeof cursor !== 'string' || !idPattern.test(cursor)))
    || typeof search !== 'string' || search.length > 100 || !['active', kind === 'archived' ? 'archived' : 'inactive', 'all'].includes(state)) throw ApiError.badRequest('Invalid filters');
  const filter = { bakeryId: req.bakeryContext.bakeryId };
  if (state !== 'all') filter[kind === 'archived' ? 'archived' : 'active'] = kind === 'archived' ? state === 'archived' : state === 'active';
  if (cursor) filter._id = { $lt: cursor };
  if (search.trim()) filter.name = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return { filter, limit: +limit };
}
async function listPage(Model, req, kind, view) {
  const { filter, limit } = listFilter(req, kind);
  const rows = await Model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  return { items: rows.map(view), nextCursor: more ? String(rows.at(-1)._id) : null };
}
function audit(req, session, action, record, before, changedFields) {
  return recordAudit(session, { bakeryId: req.bakeryContext.bakeryId, actorId: req.user._id, action,
    entityId: record._id, fromVersion: before, toVersion: record.version, fields: changedFields });
}
const listMaterials = asyncHandler(async (req, res) => res.json({ success: true, ...await listPage(Material, req, 'status', materialView) }));
const createMaterial = asyncHandler(async (req, res) => {
  const data = materialInput(req.body); await ready();
  const material = await ownerWrite(req.bakeryContext, async session => {
    await requireCapacity(Material, req.bakeryContext.bakeryId, 'materials', session);
    const [created] = await Material.create([{ ...data, bakeryId: req.bakeryContext.bakeryId }], { session });
    await audit(req, session, 'material.create', created, 0, Object.keys(data)); return created;
  });
  res.status(201).json({ success: true, material: materialView(material) });
});
const updateMaterial = asyncHandler(async (req, res) => {
  const materialId = id(req.params.materialId, 'Material'), data = materialInput(req.body, true); await ready();
  const material = await ownerWrite(req.bakeryContext, async session => {
    const current = await Material.findOne({ _id: materialId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Material not found');
    if (current.version !== req.body.expectedVersion) throw ApiError.conflict('Material changed. Reload before saving');
    await checkMaterialChange(req.bakeryContext.bakeryId, current, data, session);
    Object.assign(current, data); current.version++;
    await current.save({ session }); await audit(req, session, 'material.update', current, req.body.expectedVersion, Object.keys(data)); return current;
  });
  res.json({ success: true, material: materialView(material) });
});
async function saveRevision(req, session, recipe, input, revisionNumber) {
  await requireCapacity(Revision, req.bakeryContext.bakeryId, 'revisionsPerRecipe', session, { recipeId: recipe._id });
  const rows = await Material.find({ bakeryId: req.bakeryContext.bakeryId, active: true,
    _id: { $in: input.ingredients.map(line => line.materialId) } }).session(session).lean();
  const calculated = costRevision(input, new Map(rows.map(material => [String(material._id), material])));
  const [revision] = await Revision.create([{ ...calculated, bakeryId: req.bakeryContext.bakeryId, recipeId: recipe._id, revisionNumber }], { session });
  return revision;
}
const listRecipes = asyncHandler(async (req, res) => res.json({ success: true, ...await listPage(Recipe, req, 'archived', recipeView) }));
const createRecipe = asyncHandler(async (req, res) => {
  const input = revisionInput(req.body, ['name', 'category']);
  const name = text(req.body.name, 'recipe name', 120), category = text(req.body.category, 'category', 100);
  await ready();
  const result = await ownerWrite(req.bakeryContext, async session => {
    await requireCapacity(Recipe, req.bakeryContext.bakeryId, 'recipes', session);
    const [recipe] = await Recipe.create([{ bakeryId: req.bakeryContext.bakeryId, name, category }], { session });
    const revision = await saveRevision(req, session, recipe, input, 1);
    await audit(req, session, 'recipe.create', recipe, 0, ['name', 'category', 'revision']);
    return { recipe: recipeView(recipe), revision: revisionView(revision) };
  });
  res.status(201).json({ success: true, ...result });
});
const getRecipe = asyncHandler(async (req, res) => {
  fields(req.query, ['before', 'limit']);
  const { before, limit = '20' } = req.query;
  if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > 100
    || (before !== undefined && (typeof before !== 'string' || !/^\d{1,10}$/.test(before) || +before < 1))) throw ApiError.badRequest('Invalid revision pagination');
  const recipe = await Recipe.findOne({ _id: id(req.params.recipeId, 'Recipe'), bakeryId: req.bakeryContext.bakeryId }).lean();
  if (!recipe) throw ApiError.notFound('Recipe not found');
  const filter = { recipeId: recipe._id, bakeryId: req.bakeryContext.bakeryId };
  if (before) filter.revisionNumber = { $lt: +before };
  const rows = await Revision.find(filter).sort({ revisionNumber: -1 }).limit(+limit + 1).lean();
  const more = rows.length > +limit; if (more) rows.pop();
  res.json({ success: true, recipe: recipeView(recipe), revisions: rows.map(revisionView), nextBefore: more ? rows.at(-1).revisionNumber : null });
});
const createRevision = asyncHandler(async (req, res) => {
  const recipeId = id(req.params.recipeId, 'Recipe'), input = revisionInput(req.body, ['expectedVersion']);
  const expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER); await ready();
  const result = await ownerWrite(req.bakeryContext, async session => {
    const recipe = await Recipe.findOne({ _id: recipeId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!recipe) throw ApiError.notFound('Recipe not found');
    if (recipe.archived) throw ApiError.conflict('Restore the recipe before adding revisions');
    if (recipe.version !== expected) throw ApiError.conflict('Recipe changed. Reload before saving');
    const revision = await saveRevision(req, session, recipe, input, recipe.latestRevisionNumber + 1);
    recipe.latestRevisionNumber++; recipe.version++; await recipe.save({ session });
    await audit(req, session, 'recipe.revise', recipe, expected, ['revision']);
    return { recipe: recipeView(recipe), revision: revisionView(revision) };
  });
  res.status(201).json({ success: true, ...result });
});
const updateRecipe = asyncHandler(async (req, res) => {
  fields(req.body, ['name', 'category', 'archived', 'expectedVersion']);
  const recipeId = id(req.params.recipeId, 'Recipe'), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER), data = {};
  for (const key of ['name', 'category']) if (Object.hasOwn(req.body, key)) data[key] = text(req.body[key], key, key === 'name' ? 120 : 100);
  if (Object.hasOwn(req.body, 'archived')) {
    if (typeof req.body.archived !== 'boolean') throw ApiError.badRequest('Invalid archived flag');
    data.archived = req.body.archived;
  }
  if (!Object.keys(data).length) throw ApiError.badRequest('No changes supplied'); await ready();
  const recipe = await ownerWrite(req.bakeryContext, async session => {
    const current = await Recipe.findOne({ _id: recipeId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Recipe not found');
    if (current.version !== expected) throw ApiError.conflict('Recipe changed. Reload before saving');
    if (data.archived && await Product.exists({ bakeryId: req.bakeryContext.bakeryId, recipeId }).session(session)) throw ApiError.conflict('Unmap linked products before archiving this recipe');
    Object.assign(current, data); current.version++; await current.save({ session });
    await audit(req, session, 'recipe.update', current, expected, Object.keys(data)); return current;
  });
  res.json({ success: true, recipe: recipeView(recipe) });
});
const mapProduct = asyncHandler(async (req, res) => {
  fields(req.body, ['revisionId', 'expectedVersion']);
  if (!Object.hasOwn(req.body, 'revisionId')) throw ApiError.badRequest('A revisionId or null is required');
  const revisionId = req.body.revisionId === null ? null : id(req.body.revisionId, 'Revision');
  const productId = id(req.params.productId, 'Product'), expected = integer(req.body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER); await ready();
  const product = await ownerWrite(req.bakeryContext, async session => {
    const current = await Product.findOne({ _id: productId, bakeryId: req.bakeryContext.bakeryId }).session(session);
    if (!current) throw ApiError.notFound('Product not found');
    if (current.version !== expected) throw ApiError.conflict('Product changed. Reload before saving');
    if (current.archived && revisionId !== null) throw ApiError.conflict('Restore the product before changing its recipe mapping');
    let recipeId = null;
    if (revisionId) {
      const revision = await Revision.findOne({ _id: revisionId, bakeryId: req.bakeryContext.bakeryId }).session(session);
      if (!revision) throw ApiError.notFound('Revision not found');
      const recipe = await Recipe.findOne({ _id: revision.recipeId, bakeryId: req.bakeryContext.bakeryId, archived: false }).session(session);
      if (!recipe) throw ApiError.notFound('Recipe not found');
      recipeId = recipe._id;
    }
    current.recipeId = recipeId; current.recipeRevisionId = revisionId; current.version++; await current.save({ session });
    await audit(req, session, 'product.mapRecipe', current, expected, ['recipeId', 'recipeRevisionId']); return current;
  });
  res.json({ success: true, product: { _id: product._id, recipeId: product.recipeId, recipeRevisionId: product.recipeRevisionId, version: product.version } });
});
module.exports = { listMaterials, createMaterial, updateMaterial, listRecipes, createRecipe, getRecipe, createRevision, updateRecipe, mapProduct };
