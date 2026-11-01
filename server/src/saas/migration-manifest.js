// Offline inspection only. This module deliberately has no database dependency
// and never produces executable update operations or rewrites source records.
const { createHash } = require('node:crypto');

const TENANT_MODELS = Object.freeze([
  'Product', 'Category', 'Order', 'Coupon', 'Review', 'CakeRequest', 'ContactMessage',
  'Payment', 'EventPlan', 'AuditLog', 'StoreSettings', 'BakeryMaterial', 'BakeryRecipe',
  'BakeryProduction', 'BakeryWaste', 'BakerySupplier', 'BakeryPurchaseFormat',
  'BakeryPrice', 'BakeryRevision', 'BakerySheet', 'BakeryMovement', 'BakeryPurchase',
  'BakeryReceipt', 'BakeryMigration',
]);
const REVIEW_MODELS = Object.freeze(['User', 'Counter']);
const EXCLUDED_MODELS = Object.freeze(['AdminSession', 'Otp']);
const SOURCE_MODELS = Object.freeze([...TENANT_MODELS, ...REVIEW_MODELS, ...EXCLUDED_MODELS].sort());
const objectId = /^[a-f0-9]{24}$/i;

// [source model, path (arrays marked *), destination model, historical].
// Historical dangling references are warnings: retained price/cost snapshots
// must never be replaced by today's product or recipe values to repair them.
const REFERENCES = [
  ['Product', 'categoryId', 'Category'],
  ['Order', 'user', 'User'], ['Order', 'createdBy', 'User'],
  ['Order', 'items.*.product', 'Product', true],
  ['Order', 'recipeCostSnapshot.*.product', 'Product', true],
  ['Order', 'recipeCostSnapshot.*.recipeId', 'BakeryRecipe', true],
  ['Payment', 'order', 'Order'], ['Payment', 'user', 'User'],
  ['Review', 'product', 'Product'], ['Review', 'user', 'User'],
  ['BakeryRecipe', 'productId', 'Product'],
  ['BakeryRecipe', 'revisionFamilyId', 'BakeryRecipe'],
  ['BakeryRecipe', 'components.*.materialId', 'BakeryMaterial'],
  ['BakeryRecipe', 'components.*.subRecipeId', 'BakeryRecipe'],
  ['BakeryRecipe', 'options.*.components.*.materialId', 'BakeryMaterial'],
  ['BakeryRecipe', 'options.*.components.*.subRecipeId', 'BakeryRecipe'],
  ['BakeryPurchaseFormat', 'materialId', 'BakeryMaterial'],
  ['BakeryPurchaseFormat', 'supplierId', 'BakerySupplier'],
  ['BakeryPrice', 'formatId', 'BakeryPurchaseFormat'],
  ['BakeryPrice', 'materialId', 'BakeryMaterial'], ['BakeryPrice', 'supplierId', 'BakerySupplier'],
  ['BakeryRevision', 'recipeId', 'BakeryRecipe', true],
  ['BakeryMovement', 'materialId', 'BakeryMaterial', true],
  ['BakeryProduction', 'items.*.recipeId', 'BakeryRecipe', true],
  ['BakeryProduction', 'aggregatedIngredients.*.materialId', 'BakeryMaterial', true],
  ['BakeryProduction', 'aggregatedPackaging.*.materialId', 'BakeryMaterial', true],
  ['BakeryWaste', 'materialId', 'BakeryMaterial', true],
  ['EventPlan', 'items.*.product', 'Product', true],
  ['EventPlan', 'items.*.batches.*.recipeId', 'BakeryRecipe', true],
];
const UNIQUE_KEYS = {
  Product: [['slug']], Category: [['group', 'nameKey']], Coupon: [['code']],
  Order: [['orderNumber'], ['manualKey']], EventPlan: [['eventKey']],
  BakeryRecipe: [['productId']], BakeryRevision: [['recipeId', 'version']],
  BakerySheet: [['code']], BakeryPurchase: [['code']], BakeryReceipt: [['operationKey']],
  Review: [['product', 'user']], User: [['email'], ['phone']],
};

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// JSON-only input avoids silently losing BSON dates/decimals, undefined, NaN or
// class instances during checksumming. Extended JSON wrappers remain intact.
function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 100) throw new TypeError('Snapshot nesting exceeds 100 levels');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!Array.isArray(value) && !plain(value)) throw new TypeError('Snapshot must contain only finite JSON values');
  if (seen.has(value)) throw new TypeError('Snapshot contains a cycle');
  seen.add(value);
  const result = Array.isArray(value)
    ? '[' + Array.from(value, item => canonical(item, seen, depth + 1)).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen, depth + 1)).join(',') + '}';
  seen.delete(value);
  return result;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function idOf(value, singleton = false) {
  if (plain(value) && Object.keys(value).length === 1 && typeof value.$oid === 'string') value = value.$oid;
  if (typeof value !== 'string') return null;
  if (objectId.test(value)) return value.toLowerCase();
  return singleton && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}
function valuesAt(record, path) {
  let values = [record];
  for (const part of path.split('.')) values = values.flatMap(value => {
    if (part === '*') return Array.isArray(value) ? value : [];
    return plain(value) && Object.hasOwn(value, part) ? [value[part]] : [];
  });
  return values.filter(value => value !== null && value !== undefined && value !== '');
}

function planMigration(snapshot, bakeryId) {
  if (!objectId.test(bakeryId || '')) throw new TypeError('A 24-character bakery ObjectId is required');
  bakeryId = bakeryId.toLowerCase();
  if (!plain(snapshot) || snapshot.formatVersion !== 1 || !plain(snapshot.collections)
    || Object.keys(snapshot).some(key => !['formatVersion', 'collections'].includes(key))) {
    throw new TypeError('Expected {formatVersion: 1, collections: {ModelName: [...]}}');
  }
  // Validate every source value before returning any manifest, including
  // unknown/excluded collections. No mutation or partial processing on error.
  const sourceDigest = digest(snapshot);
  const blockers = [], warnings = [], models = new Map(), collections = [];
  for (const name of Object.keys(snapshot.collections).sort()) {
    if (!SOURCE_MODELS.includes(name)) blockers.push({ code: 'UNKNOWN_MODEL', model: name });
  }
  for (const name of SOURCE_MODELS) {
    const records = snapshot.collections[name];
    if (!Array.isArray(records)) {
      blockers.push({ code: records === undefined ? 'MISSING_MODEL' : 'INVALID_COLLECTION', model: name });
      models.set(name, new Map());
      continue;
    }
    const byId = new Map(), documents = [];
    for (const [index, record] of records.entries()) {
      const id = plain(record) ? idOf(record._id, ['StoreSettings', 'Counter'].includes(name)) : null;
      if (!id) { blockers.push({ code: 'INVALID_RECORD_ID', model: name, index }); continue; }
      if (byId.has(id)) blockers.push({ code: 'DUPLICATE_ID', model: name, id });
      byId.set(id, record);
      if (TENANT_MODELS.includes(name)) {
        for (const key of ['bakeryId', 'tenantId']) {
          if (Object.hasOwn(record, key) && idOf(record[key]) !== bakeryId) {
            blockers.push({ code: 'TENANT_CONFLICT', model: name, id, field: key });
          }
        }
      }
      documents.push({ id, sourceDigest: digest(record) });
    }
    models.set(name, byId);
    const scope = TENANT_MODELS.includes(name) ? 'tenant-review' : REVIEW_MODELS.includes(name) ? 'manual-review' : 'exclude';
    collections.push({ model: name, scope, count: records.length,
      sourceDigest: digest(records.map(record => digest(record)).sort()),
      documents: documents.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  for (const [model, paths] of Object.entries(UNIQUE_KEYS)) {
    for (const fields of paths) {
      const seen = new Map();
      for (const [id, record] of models.get(model)) {
        const key = fields.map(field => record[field]);
        if (key.some(value => value === undefined || value === null || value === '')) continue;
        const signature = canonical(key.map(value => idOf(value) || value));
        if (seen.has(signature)) blockers.push({ code: 'UNIQUE_KEY_COLLISION', model, fields, ids: [seen.get(signature), id].sort() });
        else seen.set(signature, id);
      }
    }
  }
  let checkedReferences = 0;
  for (const [model, path, target, historical] of REFERENCES) {
    for (const [id, record] of models.get(model)) {
      for (const value of valuesAt(record, path)) {
        checkedReferences++;
        const reference = idOf(value);
        if (!reference || !models.get(target).has(reference)) {
          (historical ? warnings : blockers).push({ code: historical ? 'HISTORICAL_REFERENCE_MISSING' : 'REFERENCE_MISSING', model, id, path, target });
        }
      }
    }
  }
  const stable = rows => rows.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return {
    manifestVersion: 1, mode: 'offline-dry-run', canApply: false,
    status: blockers.length ? 'blocked' : 'ready-for-manual-review', bakeryId, sourceDigest,
    collections, checkedReferences, blockers: stable(blockers), warnings: stable(warnings),
    reviewRequired: ['Target bakery and owner identity must be verified separately',
      'User identity and Counter keys require a separate migration decision',
      'AdminSession and Otp are excluded; never carry active legacy sessions',
      'Mixed snapshot payloads and references not listed by this planner require manual review',
      'Preserve historical pricing, cost snapshots, decimals and payment identifiers verbatim',
      'No schema change, index operation, data backfill or apply command is provided'],
  };
}

module.exports = { planMigration, SOURCE_MODELS, sourceChecksum: digest };
