const ApiError = require('../utils/ApiError');
const { Decimal, convertUnits } = require('../services/bakeryCost.service');
const UNITS = ['mg', 'g', 'kg', 'ml', 'L', 'piece', 'dozen', 'packet', 'box', 'minute', 'hour'];
const MATERIAL_FIELDS = ['name', 'type', 'packQuantity', 'packUom', 'purchasePricePaise', 'active'];
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw ApiError.badRequest('Unexpected fields');
}
function text(value, name, max, empty = false) {
  if (typeof value !== 'string' || value.trim().length > max || (!empty && !value.trim())) throw ApiError.badRequest(`Invalid ${name}`);
  return value.trim();
}
function integer(value, name, min = 1, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw ApiError.badRequest(`Invalid ${name}`);
  return value;
}
function quantity(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,6})?$/.test(value)) throw ApiError.badRequest('Quantity must be a decimal string with up to six decimal places');
  const number = new Decimal(value);
  if (number.lte(0) || number.gt('1000000000')) throw ApiError.badRequest('Invalid quantity');
  return number.toString();
}
function materialInput(body, updating = false) {
  fields(body, [...MATERIAL_FIELDS, ...(updating ? ['expectedVersion'] : [])]);
  const result = {};
  for (const key of Object.keys(body).filter(key => key !== 'expectedVersion')) {
    const value = body[key];
    if (key === 'name') result[key] = text(value, key, 120);
    if (key === 'type') {
      if (!['ingredient', 'packaging', 'resource', 'labour'].includes(value)) throw ApiError.badRequest('Invalid material type');
      result[key] = value;
    }
    if (key === 'packQuantity') result[key] = quantity(value);
    if (key === 'packUom') {
      if (!UNITS.includes(value)) throw ApiError.badRequest('Unsupported pack unit');
      result[key] = value;
    }
    if (key === 'purchasePricePaise') result[key] = integer(value, key, 0, 100000000);
    if (key === 'active') {
      if (typeof value !== 'boolean') throw ApiError.badRequest('Invalid active flag');
      result[key] = value;
    }
  }
  if (updating) {
    integer(body.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER);
    if (!Object.keys(result).length) throw ApiError.badRequest('No changes supplied');
  } else if (['name', 'packQuantity', 'packUom', 'purchasePricePaise'].some(key => !Object.hasOwn(result, key))) throw ApiError.badRequest('Material name and pack pricing are required');
  return result;
}
function revisionInput(body, allowedExtra = []) {
  fields(body, ['yieldPieces', 'label', 'ingredients', 'overheadPaise', 'notes', ...allowedExtra]);
  const result = {
    yieldPieces: integer(body.yieldPieces, 'yieldPieces'),
    label: body.label === undefined ? '' : text(body.label, 'label', 120, true),
    notes: body.notes === undefined ? '' : text(body.notes, 'notes', 2000, true),
    overheadPaise: body.overheadPaise === undefined ? 0 : integer(body.overheadPaise, 'overheadPaise', 0, 100000000),
  };
  if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > 100) throw ApiError.badRequest('Use 1 to 100 ingredient lines');
  result.ingredients = body.ingredients.map(line => {
    fields(line, ['materialId', 'expectedVersion', 'quantity', 'uom']);
    if (typeof line.materialId !== 'string' || !/^[a-f0-9]{24}$/i.test(line.materialId)) throw ApiError.badRequest('Invalid material reference');
    if (!UNITS.includes(line.uom)) throw ApiError.badRequest('Unsupported ingredient unit');
    return { materialId: line.materialId.toLowerCase(), expectedVersion: integer(line.expectedVersion, 'material version', 1, Number.MAX_SAFE_INTEGER), quantity: quantity(line.quantity), uom: line.uom };
  });
  return result;
}
function costRevision(input, materials) {
  let batch = new Decimal(input.overheadPaise);
  const ingredients = input.ingredients.map(line => {
    const material = materials.get(line.materialId);
    if (!material || !material.active) throw ApiError.notFound('Material not found');
    if (material.version !== line.expectedVersion) throw ApiError.conflict('A material price changed. Reload before creating this revision');
    const cost = new Decimal(convertUnits(line.quantity, line.uom, material.packUom)).mul(material.purchasePricePaise).div(material.packQuantity);
    batch = batch.add(cost);
    return { materialId: material._id, materialVersion: material.version, name: material.name, type: material.type,
      quantity: line.quantity, uom: line.uom, packQuantity: material.packQuantity, packUom: material.packUom,
      purchasePricePaise: material.purchasePricePaise, costPaise: cost.toString() };
  });
  if (batch.gt('100000000000000')) throw ApiError.badRequest('Recipe cost exceeds the supported maximum');
  return { ...input, ingredients, batchCostPaise: batch.toString(), unitCostPaise: batch.div(input.yieldPieces).toString() };
}
module.exports = { UNITS, materialInput, revisionInput, costRevision, fields, text, integer };
