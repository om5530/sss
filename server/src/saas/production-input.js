const { createHash } = require('node:crypto');
const { fields, integer, text } = require('./recipe-input');
const ApiError = require('../utils/ApiError');
function inputOf(body, recording = false) {
  fields(body, ['productId', 'revisionId', 'expectedProductVersion', 'batches', 'note', 'inventoryFingerprint', ...(recording ? ['confirmed', 'idempotencyKey'] : [])]);
  const input = { productId: body.productId, revisionId: body.revisionId,
    expectedProductVersion: integer(body.expectedProductVersion, 'expectedProductVersion', 1, Number.MAX_SAFE_INTEGER),
    batches: integer(body.batches, 'batches', 1, 1000), note: body.note === undefined ? '' : text(body.note, 'note', 1000, true) };
  for (const key of ['productId', 'revisionId']) {
    if (typeof input[key] !== 'string' || !/^[a-f0-9]{24}$/i.test(input[key])) throw ApiError.badRequest(`Invalid ${key}`);
    input[key] = input[key].toLowerCase();
  }
  if (body.inventoryFingerprint !== undefined) {
    if (typeof body.inventoryFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(body.inventoryFingerprint)) throw ApiError.badRequest('Invalid inventory review');
    input.inventoryFingerprint = body.inventoryFingerprint.toLowerCase();
  }
  if (recording) {
    if (body.confirmed !== true) throw ApiError.badRequest('Confirm that these pieces were produced');
    if (typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 production key is required');
    input.idempotencyKey = body.idempotencyKey.toLowerCase();
  }
  return input;
}
function productionHash(input, actorId) { return createHash('sha256').update(JSON.stringify({ ...input, actorId: String(actorId) })).digest('hex'); }
module.exports = { inputOf, productionHash };
