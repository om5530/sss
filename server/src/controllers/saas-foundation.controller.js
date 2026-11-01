const { identityFilter, accountWrite } = require('../saas/account-access');
const mongoose = require('mongoose');
const Bakery = require('../models/Bakery');
const Membership = require('../models/BakeryMembership');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { auditReady, recordAudit } = require('../saas/audit');
const { ownerWrite } = require('../saas/owner-write');

const reservedSlugs = new Set(['admin', 'api', 'auth', 'login', 'signup', 'new', 'saas', 'settings', 'www']);
const view = bakery => ({ _id: String(bakery._id), name: bakery.name, slug: bakery.slug,
  currency: bakery.currency, timezone: bakery.timezone, version: bakery.version });

function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.includes(key))) throw ApiError.badRequest('Unexpected bakery fields');
}
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw ApiError.badRequest('Bakery name must contain 1 to 120 characters');
  return value.trim();
}

const create = asyncHandler(async (req, res) => {
  fields(req.body, ['name', 'slug']);
  const name = nameOf(req.body.name);
  const slug = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
  if (slug.length < 3 || slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || reservedSlugs.has(slug)) {
    throw ApiError.badRequest('Choose an available bakery slug of 3 to 60 lowercase letters, numbers and separating hyphens');
  }
  // Lazy model loading may happen on the first development request. Wait for
  // unique indexes before accepting writes or starting a creation transaction.
  await Promise.all([Bakery.init(), Membership.init(), auditReady()]);
  let bakery;
  const write = async session => {
    if (req.identityType === 'saas' && await Bakery.countDocuments({ createdBy: req.user._id, createdByType: 'saas' }).session(session) >= 5) throw ApiError.conflict('This local account has reached its five-workspace creation limit');
    [bakery] = await Bakery.create([{ name, slug, createdBy: req.user._id, createdByType: req.identityType || 'legacy' }], { session });
    await Membership.create([{ bakeryId: bakery._id, userId: req.user._id, accountType: req.identityType || 'legacy', role: 'owner', active: true }], { session });
    await recordAudit(session, { bakeryId: bakery._id, actorId: req.user._id, action: 'bakery.create', entityId: bakery._id, fromVersion: 0, toVersion: 1, fields: ['name', 'slug'] });
  };
  try {
    if (req.identityType === 'saas') await accountWrite(req.workspaceAccountContext, write);
    else { const session = await mongoose.startSession(); try { await session.withTransaction(() => write(session)); } finally { await session.endSession(); } }
  } catch (err) { if (err.code === 11000) throw ApiError.conflict('This bakery slug is already in use'); throw err; }
  // Global User.role is intentionally unchanged. Bakery membership must never
  // confer access to the legacy, globally scoped /admin endpoints.
  res.status(201).json({ success: true, bakery: view(bakery), role: 'owner' });
});

const list = asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ userId: req.user._id, ...identityFilter(req.identityType), active: true }).select('bakeryId role').lean();
  const bakeries = await Bakery.find({ _id: { $in: memberships.map(m => m.bakeryId) }, status: 'active' }).sort({ name: 1, _id: 1 }).lean();
  const roles = new Map(memberships.map(m => [String(m.bakeryId), m.role]));
  res.json({ success: true, bakeries: bakeries.map(b => ({ ...view(b), role: roles.get(String(b._id)) })) });
});

const context = (req, res) => res.json({ success: true, bakery: view(req.bakery), role: req.bakeryContext.role });

const rename = asyncHandler(async (req, res) => {
  fields(req.body, ['name', 'expectedVersion']);
  const name = nameOf(req.body.name);
  if (!Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 1) throw ApiError.badRequest('A valid expectedVersion is required');
  await auditReady();
  const bakery = await ownerWrite(req.bakeryContext, async (session, current) => {
    if (current.version !== req.body.expectedVersion) throw ApiError.conflict('This bakery changed. Reload it before saving');
    current.name = name; current.version++; await current.save({ session });
    await recordAudit(session, { bakeryId: current._id, actorId: req.user._id, action: 'bakery.rename', entityId: current._id,
      fromVersion: req.body.expectedVersion, toVersion: current.version, fields: ['name'] });
    return current;
  });
  res.json({ success: true, bakery: view(bakery) });
});

module.exports = { create, list, context, rename };
