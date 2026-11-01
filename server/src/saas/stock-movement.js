const Movement = require('../models/SaasStockMovement');
async function recordMovement(session, context, data) {
  await Movement.create([{ ...data, bakeryId: context.bakeryId, actorId: context.userId, actorType: context.actorType || 'staff',
    delta: data.before === null || data.after === null ? null : data.after - data.before }], { session });
}
module.exports = { recordMovement, stockReady: () => Movement.init() };
