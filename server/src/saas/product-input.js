const ApiError = require('../utils/ApiError');

const FIELDS = ['name', 'slug', 'description', 'category', 'group', 'dietary', 'pricePaise', 'stockCount', 'available', 'featured', 'archived'];

function text(value, key, max, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.trim().length > max) throw ApiError.badRequest(`Invalid ${key}`);
  return value.trim();
}
function bodyOf(body, updating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => ![...FIELDS, ...(updating ? ['expectedVersion', 'stockCountConfirmed'] : [])].includes(key))) {
    throw ApiError.badRequest('Unexpected product fields');
  }
  if (Object.hasOwn(body, 'stockCountConfirmed') && (body.stockCountConfirmed !== true || !Object.hasOwn(body, 'stockCount'))) throw ApiError.badRequest('Confirm a supplied stock count');
  const result = {};
  for (const key of ['name', 'slug', 'category', 'description']) {
    if (Object.hasOwn(body, key)) result[key] = text(body[key], key, key === 'description' ? 2000 : key === 'category' ? 100 : 120, key === 'description');
  }
  if (Object.hasOwn(result, 'slug')) {
    result.slug = result.slug.toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.slug)) throw ApiError.badRequest('Invalid slug');
  }
  for (const [key, choices] of [['group', ['bakery', 'savoury']], ['dietary', ['veg', 'non-veg', 'egg']]]) {
    if (Object.hasOwn(body, key)) {
      if (!choices.includes(body[key])) throw ApiError.badRequest(`Invalid ${key}`);
      result[key] = body[key];
    }
  }
  for (const key of ['available', 'featured', 'archived']) {
    if (Object.hasOwn(body, key)) {
      if (typeof body[key] !== 'boolean') throw ApiError.badRequest(`Invalid ${key}`);
      result[key] = body[key];
    }
  }
  for (const [key, max] of [['pricePaise', 100000000], ['stockCount', 1000000]]) {
    if (Object.hasOwn(body, key)) {
      const value = body[key];
      if (!(key === 'stockCount' && value === null) && (!Number.isSafeInteger(value) || value < 0 || value > max)) {
        throw ApiError.badRequest(`Invalid ${key}`);
      }
      result[key] = value;
    }
  }
  if (!updating && ['name', 'slug', 'category', 'pricePaise'].some(key => !Object.hasOwn(result, key))) throw ApiError.badRequest('Name, slug, category and pricePaise are required');
  if (updating && (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || !Object.keys(result).length)) {
    throw ApiError.badRequest('Changes and a valid expectedVersion are required');
  }
  return result;
}
module.exports = { productFields: FIELDS, parseProductInput: bodyOf };
