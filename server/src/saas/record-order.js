const Bakery = require('../models/Bakery');
const Order = require('../models/SaasOrder');
const Event = require('../models/SaasEvent');
const Product = require('../models/SaasProduct');
const Revision = require('../models/SaasRecipeRevision');
const Payment = require('../models/SaasPaymentEntry');
const { requireCapacity } = require('./usage-limits');
const { recordMovement, stockReady } = require('./stock-movement');
const { entry } = require('./order-balance');
const { auditReady, recordAudit } = require('./audit');
const ApiError = require('../utils/ApiError');
async function orderReady() { await Promise.all([Event.init(), Order.init(), Payment.init(), stockReady(), auditReady()]); }
async function recordOrder(session, context, input, requestHash) {
    const bakeryId = context.bakeryId;
    const previous = await Order.findOne({ bakeryId, idempotencyKey: input.idempotencyKey }).select('+requestHash +customerId').session(session);
    if (previous) {
      if (previous.requestHash !== requestHash || String(previous.customerId || '') !== String(context.customerId || '')) throw new ApiError(409, 'This submission key was already used for different order details', { code: 'SALE_KEY_CONFLICT', ...(context.customerId ? {} : { orderId: String(previous._id) }) });
      return { order: previous, replayed: true };
    }
    // Only failures after the transaction proved this key has no saved order
    // may authorize the client to discard its durable retry record.
    try {
      if (context.customerId && input.expectedReservationMinutes !== context.reservationMinutes) throw ApiError.conflict('Pickup reservation terms changed. Review this order again');
      if (context.customerId && !context.accepting) throw ApiError.conflict('Pickup ordering is paused');
      if (context.customerId && await Order.countDocuments({ bakeryId, customerId: context.customerId, paymentStatus: 'unpaid', reservationStatus: { $nin: ['cancelled', 'expired'] } }).session(session) >= 3) throw ApiError.conflict('Please collect and pay for your earlier pickup orders before placing another');
      await requireCapacity(Order, bakeryId, 'orders', session);
      if (input.eventId) {
        const event = await Event.findOne({ _id: input.eventId, bakeryId }).session(session);
        if (!event) throw ApiError.notFound('Event not found');
        if (event.status !== 'open') throw ApiError.conflict('This event is closed');
      }
      let subtotalPaise = 0;
      const items = [], costSnapshot = [], stockChanges = [];
      for (const line of input.items) {
        const product = await Product.findOne({ _id: line.productId, bakeryId, archived: false, available: true }).session(session);
        if (!product) throw ApiError.notFound('Product not found');
        if (product.pricePaise !== line.expectedUnitPricePaise) throw ApiError.conflict('A product price changed. Refresh and review this order before saving');
        if (product.stockCount !== null && product.stockCount < line.quantity) throw ApiError.conflict('Insufficient product stock');
        const lineTotalPaise = product.pricePaise * line.quantity;
        subtotalPaise += lineTotalPaise;
        if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise > 1000000000000) throw ApiError.badRequest('Order amount exceeds the supported maximum');
        items.push({ productId: product._id, name: product.name, quantity: line.quantity, unitPricePaise: product.pricePaise, lineTotalPaise, stockClaimed: product.stockCount !== null, stockEpoch: product.stockEpoch || 1 });
        let revision = null;
        if (product.recipeRevisionId) {
          revision = await Revision.findOne({ _id: product.recipeRevisionId, recipeId: product.recipeId, bakeryId }).session(session);
          if (!revision) throw ApiError.conflict(context.customerId ? 'A product is temporarily unavailable' : 'Repair this product recipe mapping before recording a sale');
        }
        costSnapshot.push({ productId: product._id, recipeId: revision?.recipeId || null, revisionId: revision?._id || null,
          revisionNumber: revision?.revisionNumber || null, yieldPieces: revision?.yieldPieces || null,
          unitCostPaise: revision?.unitCostPaise ?? null, batchCostPaise: revision?.batchCostPaise ?? null });
        if (product.stockCount !== null) {
          const before = product.stockCount; product.stockCount -= line.quantity; product.version++; await product.save({ session });
          stockChanges.push({ productId: product._id, kind: 'sale', before, after: product.stockCount, productVersion: product.version });
        }
      }
      if (input.discountPaise > subtotalPaise) throw ApiError.badRequest('Discount exceeds the order subtotal');
      const bakery = await Bakery.findOneAndUpdate({ _id: bakeryId, status: 'active' }, { $inc: { nextOrderNumber: 1 } }, { session, new: true });
      if (!bakery || !Number.isSafeInteger(bakery.nextOrderNumber)) throw ApiError.conflict('Order numbering is unavailable');
      const [order] = await Order.create([{ bakeryId, ...(context.customerId ? { customerId: context.customerId, source: 'storefront', fulfillment: 'pickup', pickupStatus: 'pending', reservationStatus: 'active', reservationExpiresAt: new Date(Date.now() + context.reservationMinutes * 60000) } : { source: 'counter' }), eventId: input.eventId, sequence: bakery.nextOrderNumber,
        orderNumber: `ORD-${String(bakery.nextOrderNumber).padStart(6, '0')}`, items, costSnapshot,
        subtotalPaise, discountPaise: input.discountPaise, totalPaise: subtotalPaise - input.discountPaise,
        receivedPaise: input.paymentStatus === 'paid' ? subtotalPaise - input.discountPaise : 0,
        paymentStatus: input.paymentStatus, paymentMethod: input.paymentMethod, comment: input.comment,
        actorId: context.actorId, idempotencyKey: input.idempotencyKey, requestHash }], { session });
      for (const change of stockChanges) await recordMovement(session, { bakeryId, userId: context.actorId, actorType: context.customerId ? 'customer' : 'staff' }, { ...change, orderId: order._id });
      if (input.paymentStatus === 'paid') await entry(session, order, context.actorId, { kind: 'receipt', amountPaise: order.totalPaise,
        paymentMethod: input.paymentMethod, operationKey: `initial:${input.idempotencyKey}`, reason: '' });
      await recordAudit(session, { bakeryId, actorId: context.actorId, ...(context.customerId ? { actorType: 'customer' } : {}), action: context.customerId ? 'customer.order' : 'order.create', entityId: order._id, fromVersion: 0, toVersion: 1, fields: ['items', 'paymentStatus', 'discountPaise'] }); return { order, replayed: false };
    } catch (error) {
      if (context.customerId && error.details?.code === 'SAAS_SUBSCRIPTION_RESTRICTED') error.message = 'Pickup ordering is paused';
      if ([400, 404, 409].includes(error.statusCode)) error.details = { code: 'SALE_REJECTED' };
      throw error;
    }
}
module.exports = { recordOrder, orderReady };
