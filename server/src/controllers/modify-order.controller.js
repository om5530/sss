const mongoose = require('mongoose');
const { body } = require('express-validator');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertEventOpen } = require('../services/event-sales.service');
const { audit } = require('../services/audit.service');
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const modify = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Order not found');
  const session = await mongoose.startSession();
  let order, before;
  try {
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).select('+comment').session(session);
      if (!order) throw ApiError.notFound('Order not found');
      if (order.orderStatus === 'cancelled' || order.paymentStatus === 'refunded') throw ApiError.conflict('Cancelled or refunded orders cannot be modified');
      await assertEventOpen(order, session);
      if (order.updatedAt.toISOString() !== req.body.expectedUpdatedAt) throw ApiError.conflict('This order changed. Refresh it before modifying.');
      if (req.body.items.length !== order.items.length) throw ApiError.badRequest('Review all existing order items');
      before = { items: order.items.map(i => i.toObject()), pricing: order.pricing.toObject(), comment: order.comment || '' };
      for (let index = 0; index < order.items.length; index++) {
        const item = order.items[index], change = req.body.items[index];
        const delta = change.quantity - item.quantity;
        if (delta && item.stockClaimed) {
          const filter = { _id: item.product, stockCount: { $ne: null, ...(delta > 0 ? { $gte: delta } : {}) } };
          const product = await Product.findOneAndUpdate(filter, { $inc: { stockCount: -delta } }, { new: true, session });
          if (!product) throw ApiError.conflict('Stock changed or insufficient stock. Review the quantity.');
          if (product.stockCount <= 0) { product.available = false; product.stockSoldOut = true; }
          else if (product.stockSoldOut && !product.archived) { product.available = true; product.stockSoldOut = false; }
          await product.save({ session });
        }
        item.price = change.price;
        item.quantity = change.quantity;
        item.lineTotal = round(change.price * change.quantity);
      }
      const subtotal = round(order.items.reduce((sum, i) => sum + i.lineTotal, 0));
      const discount = req.body.discount ?? (order.pricing.discount || 0);
      if (discount > subtotal) throw ApiError.badRequest('Discount cannot exceed the subtotal');
      const oldTaxable = before.pricing.subtotal - (before.pricing.discount || 0);
      const taxRate = before.pricing.taxRate ?? (oldTaxable > 0 ? before.pricing.tax / oldTaxable : 0);
      const tax = round((subtotal - discount) * taxRate);
      order.pricing.subtotal = subtotal;
      order.pricing.discount = discount;
      if (discount !== (before.pricing.discount || 0)) order.pricing.couponCode = undefined;
      order.pricing.tax = tax;
      order.pricing.taxRate = taxRate;
      order.pricing.total = round(subtotal - discount + tax + (order.pricing.deliveryFee || 0));
      if (req.body.comment !== undefined) order.comment = req.body.comment;
      order.statusHistory.push({ status: order.orderStatus, note: `Order modified by staff: ₹${before.pricing.total} → ₹${order.pricing.total}. ${req.body.reason}`, at: new Date() });
      await order.save({ session });
      // Correct recorded in-person receipts only; gateway captures remain immutable.
      await Payment.updateOne({ order: order._id, provider: { $in: ['manual', 'cash'] }, status: { $in: ['requires_payment', 'succeeded'] } }, { $set: { amount: order.pricing.total } }, { session });
    });
  } finally { await session.endSession(); }
  audit(req, { action: 'order.modify', entity: 'order', entityId: order._id, summary: `${order.orderNumber}: ${req.body.reason}`, before, after: { items: order.items, pricing: order.pricing, comment: order.comment } });
  res.json({ success: true, order });
});
module.exports = { modify, validators: [
  body('discount').optional().isFloat({ min: 0, max: 1000000000000 }).custom(v => Number.isFinite(Number(v)) && Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 0.000001).toFloat(),
  body('comment').optional().isString().bail().trim().isLength({ max: 1000 }),
  body('confirmed').equals('true'), body('expectedUpdatedAt').isISO8601(),
  body('reason').isString().bail().trim().isLength({ min: 1, max: 500 }),
  body('items').isArray({ min: 1, max: 100 }),
  body('items.*.quantity').isInt({ min: 1, max: 10000 }).toInt(),
  body('items.*.price').isFloat({ min: 0, max: 1000000 }).custom(v => Number.isFinite(Number(v)) && Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 0.000001).toFloat(),
] };
