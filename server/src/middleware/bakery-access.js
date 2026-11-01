const { identityFilter } = require('../saas/account-access');
const Bakery = require('../models/Bakery');
const Membership = require('../models/BakeryMembership');
const ApiError = require('../utils/ApiError');

// Never select a tenant from body/header/JWT claims. Every request checks
// current membership, so revoked access is not kept alive by a valid token.
async function requireBakery(req, res, next) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const id = req.params.bakeryId;
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw ApiError.notFound('Bakery not found');
    const membership = await Membership.findOne({ bakeryId: id, userId: req.user._id, ...identityFilter(req.identityType), active: true }).lean();
    if (!membership) throw ApiError.notFound('Bakery not found');
    const bakery = await Bakery.findOne({ _id: id, status: 'active' }).lean();
    if (!bakery) throw ApiError.notFound('Bakery not found');
    req.bakery = bakery;
    req.bakeryContext = Object.freeze({ bakeryId: String(bakery._id), userId: String(req.user._id), role: membership.role, identityType: req.identityType || 'legacy', ...(req.workspaceAccountContext || {}) });
    next();
  } catch (err) { next(err); }
}

function requireBakeryOwner(req, res, next) {
  if (!req.bakeryContext) return next(ApiError.unauthorized());
  if (req.bakeryContext.role !== 'owner') return next(ApiError.forbidden('Only bakery owners can change bakery settings'));
  next();
}

module.exports = { requireBakery, requireBakeryOwner };
