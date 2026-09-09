const Category = require('../models/Category');
const Product = require('../models/Product');
const { migrateCategories } = require('../services/category.service');
const { audit } = require('../services/audit.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const mongoose = require('mongoose');

const list = asyncHandler(async (req, res) => {
  await migrateCategories();
  const categories = await Category.aggregate([
    { $lookup: { from: 'products', localField: '_id', foreignField: 'categoryId', pipeline: [{ $count: 'count' }], as: 'usage' } },
    { $addFields: { count: { $ifNull: [{ $first: '$usage.count' }, 0] } } },
    { $match: { $or: [{ archived: false }, { count: { $gt: 0 } }] } },
    { $project: { usage: 0, nameKey: 0 } },
    { $sort: { group: 1, displayOrder: 1, name: 1 } },
  ]);
  res.json({ success: true, categories });
});

function fields(body) {
  if (!['bakery', 'savoury'].includes(body.group) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) {
    throw ApiError.badRequest('Enter a category name (up to 80 characters) and choose a group.');
  }
  return { name: body.name.trim(), nameKey: body.name.trim().toLowerCase(), group: body.group };
}

const create = asyncHandler(async (req, res) => {
  await migrateCategories();
  const data = fields(req.body);
  const last = await Category.findOne({ group: data.group }).sort({ displayOrder: -1 });
  let category;
  try { category = await Category.create({ ...data, displayOrder: (last?.displayOrder ?? 0) + 1 }); }
  catch (err) { if (err.code === 11000) throw ApiError.conflict('That category already exists in this group.'); throw err; }
  audit(req, { action: 'category.create', entity: 'category', entityId: category._id, summary: `Created category ${category.name}`, after: data });
  res.status(201).json({ success: true, category });
});

const update = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category || category.archived) throw ApiError.notFound('Category not found');
  const data = fields({ ...req.body, group: req.body.group ?? category.group });
  if (data.group !== category.group) throw ApiError.badRequest('A category stays in its group. Reassign products to move them between groups.');
  const before = { name: category.name, group: category.group };
  Object.assign(category, data);
  try { await category.save(); }
  catch (err) { if (err.code === 11000) throw ApiError.conflict('That category already exists in this group.'); throw err; }
  audit(req, { action: 'category.rename', entity: 'category', entityId: category._id, summary: `Renamed category ${before.name} to ${category.name}`, before, after: data });
  res.json({ success: true, category });
});

const remove = asyncHandler(async (req, res) => {
  await migrateCategories();
  const category = await Category.findById(req.params.id);
  if (!category || category.archived) throw ApiError.notFound('Category not found');
  const count = await Product.countDocuments({ categoryId: category._id });
  if (count) throw ApiError.conflict(`This category has ${count} products (including archived items). Reassign them from the product editor before deleting it.`);
  // Keep a tombstone so a concurrent old product request never loses its label.
  category.archived = true;
  category.nameKey = `removed:${category._id}`;
  await category.save();
  audit(req, { action: 'category.delete', entity: 'category', entityId: category._id, summary: `Deleted category ${category.name}`, before: { name: category.name, group: category.group } });
  res.json({ success: true });
});

const reorder = asyncHandler(async (req, res) => {
  const { group, ids } = req.body;
  if (!['bakery', 'savoury'].includes(group) || !Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id)) || new Set(ids).size !== ids.length) {
    throw ApiError.badRequest('Supply each category in this group exactly once.');
  }
  const categories = await Category.find({ group, archived: false });
  if (ids.length !== categories.length || categories.some((c) => !ids.includes(String(c._id)))) throw ApiError.conflict('The category list changed. Refresh before reordering.');
  if (ids.length) await Category.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id, group, archived: false }, update: { $set: { displayOrder: index } } } })));
  audit(req, { action: 'category.reorder', entity: 'category', summary: `Reordered ${group} categories`, before: categories.map((c) => ({ id: c._id, order: c.displayOrder })), after: { ids } });
  res.json({ success: true });
});

module.exports = { list, create, update, remove, reorder };
