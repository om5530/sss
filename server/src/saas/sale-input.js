const ApiError = require('../utils/ApiError');
const { fields, text, integer } = require('./recipe-input');
const { sourceChecksum } = require('./migration-manifest');
const idPattern = /^[a-f0-9]{24}$/i;
const METHODS = ['cash', 'upi', 'card'];
function saleInput(body) {
  fields(body, ['eventId', 'items', 'discountPaise', 'paymentStatus', 'paymentMethod', 'comment', 'idempotencyKey']);
  if (body.eventId !== undefined && body.eventId !== null && (typeof body.eventId !== 'string' || !idPattern.test(body.eventId))) throw ApiError.badRequest('Invalid event');
  if (!['paid', 'unpaid'].includes(body.paymentStatus) || (body.paymentStatus === 'paid' && !METHODS.includes(body.paymentMethod))
    || (body.paymentStatus === 'unpaid' && body.paymentMethod !== undefined && body.paymentMethod !== null)) throw ApiError.badRequest('Invalid manual payment details');
  if (typeof body.idempotencyKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.idempotencyKey)) throw ApiError.badRequest('A UUID v4 idempotency key is required');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw ApiError.badRequest('Use 1 to 100 order lines');
  const seen = new Set();
  const items = body.items.map(line => {
    fields(line, ['productId', 'quantity', 'expectedUnitPricePaise']);
    if (typeof line.productId !== 'string' || !idPattern.test(line.productId)) throw ApiError.badRequest('Invalid product');
    const productId = line.productId.toLowerCase();
    if (seen.has(productId)) throw ApiError.badRequest('Combine repeated products into one line');
    seen.add(productId);
    return { productId, quantity: integer(line.quantity, 'quantity', 1, 10000),
      expectedUnitPricePaise: integer(line.expectedUnitPricePaise, 'reviewed product price', 0, 100000000) };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
  return { eventId: body.eventId?.toLowerCase() || null, items,
    discountPaise: body.discountPaise === undefined ? 0 : integer(body.discountPaise, 'discountPaise', 0, 1000000000000),
    paymentStatus: body.paymentStatus, paymentMethod: body.paymentMethod || null,
    comment: body.comment === undefined ? '' : text(body.comment, 'comment', 1000, true), idempotencyKey: body.idempotencyKey.toLowerCase() };
}
function saleHash(input, actorId) { return sourceChecksum({ ...input, actorId: String(actorId) }); }
module.exports = { saleInput, saleHash, METHODS };
