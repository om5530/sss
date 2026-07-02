const mongoose = require('mongoose');

// Append-only record of every mutating admin action (AS-1.3). There are no
// update/delete endpoints for this collection by design.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorName: { type: String, default: '' },
    action: { type: String, required: true, index: true }, // e.g. 'order.status', 'product.create'
    entity: { type: String, required: true, index: true }, // 'order' | 'product' | 'payment' | ...
    entityId: { type: String, default: '' },
    summary: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
