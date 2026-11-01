const AuditLog = require('../models/SaasAuditLog');
const auditReady = () => AuditLog.init();
async function recordAudit(session, { bakeryId, actorId, actorType = 'staff', action, entityId, fromVersion, toVersion, fields }) {
  await AuditLog.create([{ bakeryId, actorId, actorType, action, entityId, fromVersion, toVersion, fields: [...fields].sort() }], { session });
}
module.exports = { auditReady, recordAudit };
