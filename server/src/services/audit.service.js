const AuditLog = require('../models/AuditLog');

/**
 * Records an admin action. Fire-and-forget: a failed audit write is logged but
 * never blocks or rolls back the action itself (AS-1.3).
 */
function audit(req, { action, entity, entityId, summary, before, after }) {
  const actor = req.user;
  if (!actor) return;
  AuditLog.create({
    actor: actor._id,
    actorName: actor.name || actor.phone || actor.email || 'admin',
    action,
    entity,
    entityId: entityId ? String(entityId) : '',
    summary,
    before,
    after,
  }).catch((err) => console.error('[audit] failed to record entry:', err.message));
}

module.exports = { audit };
