// Pure preview/reconciliation only. Never import application models here.
const { planMigration, sourceChecksum } = require('./migration-manifest');
const { parseProductInput, productFields } = require('./product-input');
const idOf = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) ? value.toLowerCase()
  : value && Object.keys(value).length === 1 && typeof value.$oid === 'string' ? idOf(value.$oid) : null;

function paiseOf(value) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1) value = value.$numberDecimal ?? value.$numberDouble ?? value.$numberInt ?? value.$numberLong;
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Invalid source price');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new TypeError('Source price needs an explicit rounding decision');
  const result = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100000000) throw new TypeError('Source price exceeds target bounds');
  return result;
}
function dateOf(value) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1) value = value.$date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new TypeError('Invalid source timestamp');
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== canonical) throw new TypeError('Invalid source timestamp');
  return canonical;
}
function targetValue(value, field) {
  if (['_id', 'bakeryId'].includes(field)) return idOf(value);
  if (['createdAt', 'updatedAt'].includes(field)) return dateOf(value);
  if (['pricePaise', 'stockCount', 'schemaVersion', 'version'].includes(field)
    && value && typeof value === 'object' && Object.keys(value).length === 1) {
    const number = value.$numberInt ?? value.$numberLong ?? value.$numberDouble;
    if (typeof number === 'string' && /^-?\d+(?:\.0+)?$/.test(number) && Number.isSafeInteger(Number(number))) return Number(number);
  }
  return value;
}

function previewProductImport(snapshot, bakeryId) {
  const manifest = planMigration(snapshot, bakeryId);
  const blockers = [...manifest.blockers], warnings = [...manifest.warnings], candidates = [];
  // A partial snapshot, tenant conflict or broken live reference must not be
  // treated as a valid import merely because its product rows look plausible.
  if (!blockers.length) for (const source of snapshot.collections.Product) {
    const id = idOf(source._id), issues = [];
    const legacyFields = ['_id', 'name', 'slug', 'group', 'category', 'categoryId', 'description', 'price', 'image', 'dietary', 'tags',
      'available', 'featured', 'stockCount', 'stockSoldOut', 'ratingAvg', 'ratingCount', 'archived', 'deletedAt',
      'createdAt', 'updatedAt', '__v', 'bakeryId', 'tenantId'];
    const unknown = Object.keys(source).filter(field => !legacyFields.includes(field));
    if (unknown.length) issues.push({ code: 'UNKNOWN_PRODUCT_FIELDS', id, fields: unknown.sort() });
    const unsupported = ['image', 'tags', 'ratingAvg', 'ratingCount'].filter(field => {
      const value = source[field];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '' && value !== 0;
    });
    if (unsupported.length) issues.push({ code: 'UNSUPPORTED_PRODUCT_FIELDS', id, fields: unsupported });
    if (source.deletedAt !== undefined && source.deletedAt !== null) issues.push({ code: 'DELETED_PRODUCT_NEEDS_TOMBSTONE_POLICY', id });
    try {
      const data = parseProductInput({ name: source.name, slug: source.slug, category: source.category,
        group: source.group, dietary: source.dietary === undefined ? 'veg' : source.dietary, description: source.description === undefined ? '' : source.description,
        pricePaise: paiseOf(source.price), stockCount: source.stockCount ?? null,
        available: source.available === undefined ? true : source.available,
        featured: source.featured === undefined ? false : source.featured, archived: source.archived === undefined ? false : source.archived });
      if (source.categoryId) warnings.push({ code: 'CATEGORY_REFERENCE_REQUIRES_IMPORT_POLICY', id, field: 'categoryId' });
      const document = { _id: id, bakeryId: manifest.bakeryId, schemaVersion: 1, version: 1, recipeId: null, recipeRevisionId: null, ...data };
      for (const field of ['createdAt', 'updatedAt']) {
        if (source[field] === undefined) continue;
        document[field] = dateOf(source[field]);
      }
      if (!issues.length) candidates.push({ sourceId: id, sourceDigest: sourceChecksum(source), document });
    } catch {
      issues.push({ code: 'PRODUCT_CONVERSION_REQUIRES_REVIEW', id });
    }
    blockers.push(...issues);
  }
  candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { previewVersion: 1, mode: 'offline-product-preview', canApply: false,
    status: blockers.length ? 'blocked' : 'ready-for-manual-review', bakeryId: manifest.bakeryId,
    sourceDigest: manifest.sourceDigest, candidates, blockers, warnings };
}

function reconcileProductImport(snapshot, bakeryId, targetProducts) {
  if (!Array.isArray(targetProducts)) throw new TypeError('Target products must be a JSON array');
  sourceChecksum(targetProducts); // Reject lossy/non-JSON inputs before comparison.
  const preview = previewProductImport(snapshot, bakeryId), differences = [];
  const expected = new Map(preview.candidates.map(row => [row.sourceId, row.document])), seen = new Set();
  for (const [index, actual] of targetProducts.entries()) {
    const id = idOf(actual?._id);
    if (!id || seen.has(id)) { differences.push({ code: id ? 'DUPLICATE_TARGET_ID' : 'INVALID_TARGET_ID', index }); continue; }
    seen.add(id);
    if (idOf(actual.bakeryId) !== preview.bakeryId) { differences.push({ code: 'FOREIGN_TARGET_RECORD', id }); continue; }
    const wanted = expected.get(id);
    if (!wanted) { differences.push({ code: 'UNEXPECTED_TARGET_RECORD', id }); continue; }
    const allowed = ['_id', 'bakeryId', 'schemaVersion', 'version', ...productFields, 'createdAt', 'updatedAt', '__v'];
    const fields = [...new Set([...Object.keys(wanted), ...Object.keys(actual).filter(field => !allowed.includes(field))])]
      .filter(field => {
        try {
          const value = targetValue(actual[field], field);
          return value === undefined || !Object.hasOwn(wanted, field) || sourceChecksum(value) !== sourceChecksum(wanted[field]);
        } catch { return true; }
      });
    if (fields.length) differences.push({ code: 'PRODUCT_FIELDS_DIFFER', id, fields: fields.sort() });
  }
  for (const id of expected.keys()) if (!seen.has(id)) differences.push({ code: 'TARGET_PRODUCT_MISSING', id });
  return { reconciliationVersion: 1, canApply: false, sourceDigest: preview.sourceDigest,
    status: preview.blockers.length || differences.length ? 'blocked' : 'matched',
    expectedCount: expected.size, targetCount: targetProducts.length, blockers: preview.blockers,
    warnings: preview.warnings, differences };
}
module.exports = { previewProductImport, reconcileProductImport };
