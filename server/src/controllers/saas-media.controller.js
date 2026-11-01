const mongoose = require('mongoose');
const Media = require('../models/SaasMedia');
const Product = require('../models/SaasProduct');
const Bakery = require('../models/Bakery');
const Storefront = require('../models/SaasStorefront');
const { normalizeImage } = require('../saas/media-images');
const { ownerWrite } = require('../saas/owner-write');
const { fields, integer } = require('../saas/recipe-input');
const { auditReady, recordAudit } = require('../saas/audit');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const missing = () => ApiError.notFound('Image not found');
function slot(req) {
 const { kind, targetId } = req.params;
 if (!['logo', 'product'].includes(kind) || !/^[a-f0-9]{24}$/i.test(targetId || '')) throw missing();
 return { bakeryId: req.bakeryContext.bakeryId, kind, targetId };
}
async function target(filter, session) {
 if (filter.kind === 'logo') { if (String(filter.targetId) !== String(filter.bakeryId)) throw missing(); return; }
 const query = Product.exists({ _id: filter.targetId, bakeryId: filter.bakeryId }); if (session) query.session(session); if (!await query) throw missing();
}
const bytesOf = value => Buffer.isBuffer(value) ? value : Buffer.from(value.value(true));
const view = row => ({ version: row?.version || 0, image: row?.active ? { width: row.width, height: row.height, byteLength: row.byteLength, dataUrl: `data:image/webp;base64,${bytesOf(row.bytes).toString('base64')}` } : null });
const get = asyncHandler(async (req, res) => { fields(req.query, []); const filter = slot(req); await target(filter); const row = await Media.findOne(filter).select('+bytes').lean(); res.json({ slot: view(row) }); });
const save = asyncHandler(async (req, res) => {
 fields(req.body, ['imageBase64', 'expectedVersion', 'confirmed']);
 if (req.body.confirmed !== true) throw ApiError.badRequest('Review and confirm the image change');
 const filter = slot(req), expected = integer(req.body.expectedVersion, 'expectedVersion', 0, Number.MAX_SAFE_INTEGER);
 await target(filter);
 const data = req.body.imageBase64 === null ? null : await normalizeImage(req.body.imageBase64, filter.kind);
 await Promise.all([Media.init(), auditReady()]);
 const row = await ownerWrite(req.bakeryContext, async session => {
  await target(filter, session); let current = await Media.findOne(filter).select('+bytes').session(session);
  if ((current?.version || 0) !== expected) throw ApiError.conflict('Image changed. Reload before saving');
  if (!data && !current?.active) throw ApiError.conflict('There is no image to remove. Reload the image');
  if (data) {
   const [usage] = await Media.aggregate([{ $match: { bakeryId: new mongoose.Types.ObjectId(filter.bakeryId), active: true } }, { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$byteLength' } } }]).session(session);
   if ((usage?.count || 0) + (current?.active ? 0 : 1) > 128 || (usage?.bytes || 0) - (current?.active ? current.byteLength : 0) + data.byteLength > 16 * 1024 * 1024) throw ApiError.conflict('This local bakery has reached its image storage limit. Remove an existing image first');
  }
  const update = data ? { ...data, active: true } : { active: false, bytes: undefined, hash: '', byteLength: 0, width: 0, height: 0 };
  if (!current) [current] = await Media.create([{ ...filter, ...update }], { session });
  else { Object.assign(current, update); current.version++; await current.save({ session }); }
  await recordAudit(session, { bakeryId: filter.bakeryId, actorId: req.user._id, action: 'media.update', entityId: current._id, fromVersion: expected, toVersion: current.version, fields: [data ? 'image' : 'removed'] });
  return current;
 }); res.json({ slot: view(row) });
});
const publicGet = asyncHandler(async (req, res) => {
 fields(req.query, []);
 const { slug, mediaId, version, hash } = req.params;
 if (!/^[1-9][0-9]{0,15}$/.test(version || '') || !Number.isSafeInteger(Number(version)) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 60 || !/^[a-f0-9]{24}$/i.test(mediaId || '') || !/^[a-f0-9]{64}$/.test(hash || '')) throw missing();
 const bakery = await Bakery.findOne({ slug, status: 'active' }).select('_id').lean(); if (!bakery) throw missing();
 const settings = await Storefront.findOne({ bakeryId: bakery._id, published: true }).select('showUnavailable').lean(); if (!settings) throw missing();
 const row = await Media.findOne({ _id: mediaId, bakeryId: bakery._id, version: Number(version), hash, active: true }).select('+bytes').lean(); if (!row) throw missing();
 if (row.kind === 'logo') { if (String(row.targetId) !== String(bakery._id)) throw missing(); }
 else {
  const filter = { _id: row.targetId, bakeryId: bakery._id, archived: false };
  if (!settings.showUnavailable) { filter.available = true; filter.$or = [{ stockCount: null }, { stockCount: { $gt: 0 } }]; }
  if (!await Product.exists(filter)) throw missing();
 }
 res.set({ 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-site' });
 res.send(bytesOf(row.bytes));
});
module.exports = { get, save, publicGet };
