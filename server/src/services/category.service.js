const Category = require('../models/Category');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');

// Idempotent migration: existing strings are retained as fallbacks; products
// gain stable references so a rename never requires a multi-document rewrite.
async function migrateCategories() {
  const legacy = await Product.aggregate([
    { $match: { categoryId: null } },
    { $group: { _id: { group: '$group', name: '$category' } } },
    { $sort: { '_id.group': 1, '_id.name': 1 } },
  ]);
  for (const { _id: { group, name } } of legacy) {
    const nameKey = name.trim().toLowerCase();
    let category;
    try {
      category = await Category.findOneAndUpdate({ group, nameKey }, { $setOnInsert: { name, displayOrder: Date.now() } }, { upsert: true, new: true });
    } catch (err) {
      if (err.code !== 11000) throw err;
      category = await Category.findOne({ group, nameKey });
    }
    await Product.updateMany({ group, category: name, categoryId: null }, { $set: { categoryId: category._id } }, { timestamps: false });
  }
}

async function resolveCategory(group, name) {
  await migrateCategories();
  const category = await Category.findOne({ group, nameKey: String(name || '').trim().toLowerCase(), archived: false });
  if (!category) throw ApiError.badRequest('Choose an existing category for this group. Create categories from the Categories page.');
  return category;
}

async function decorateProducts(products) {
  const categories = await Category.find({ _id: { $in: products.map((p) => p.categoryId).filter(Boolean) } }).lean();
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  return products.map((p) => {
    const row = p.toObject ? p.toObject() : p;
    const category = byId.get(String(row.categoryId));
    return { ...row, category: category?.name || row.category, categoryOrder: category?.displayOrder ?? Number.MAX_SAFE_INTEGER };
  });
}

module.exports = { migrateCategories, resolveCategory, decorateProducts };
