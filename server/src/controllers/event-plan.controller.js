const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const EventPlan = require('../models/EventPlan');
const Order = require('../models/Order');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { linkedCosts } = require('../services/recipe-product.service');
const { transaction } = require('../services/bakery-transaction.service');
const { eventNameOf, eventKeyOf, eventSalesReport } = require('../services/event-sales.service');
const { audit } = require('../services/audit.service');
const { syncPreparedStock } = require('../services/event-product-stock.service');

// The sale form needs names and availability, not a full financial report.
const options = asyncHandler(async (req, res) => {
  const [plans, sales] = await Promise.all([
    EventPlan.find().select('eventName eventKey status').lean(),
    Order.aggregate([
      { $match: { source: 'event' } },
      { $group: { _id: { $toLower: '$eventName' }, eventName: { $last: '$eventName' }, lastSaleAt: { $max: '$createdAt' } } },
    ]),
  ]);
  const events = new Map(sales.map(sale => [eventKeyOf(sale.eventName), {
    eventName: sale.eventName, status: 'unconfigured', lastSaleAt: sale.lastSaleAt,
  }]));
  for (const plan of plans) {
    events.set(plan.eventKey, { eventName: plan.eventName, status: plan.status,
      lastSaleAt: events.get(plan.eventKey)?.lastSaleAt || null });
  }
  res.json({ success: true, events: [...events.values()].sort((a, b) => a.eventName.localeCompare(b.eventName)) });
});

function count(value, label, min = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 1000000) throw ApiError.badRequest(`${label} must be a whole number between ${min} and 1,000,000`);
  return value;
}
function amount(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000 || new Decimal(value).decimalPlaces() > 2) {
    throw ApiError.badRequest(`${label} must be ₹0 or more, with at most two decimal places`);
  }
  return value;
}
function date(value, label) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw ApiError.badRequest(`Enter a valid ${label}`);
  return value;
}
function idOf(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Event not found');
  return id;
}
function versionOf(body) { return count(body.version, 'Version', 1); }
function planView(plan, stock = plan.finalReport?.stock || []) {
  return { _id: String(plan._id), eventName: plan.eventName, startDate: plan.startDate, endDate: plan.endDate,
    rent: plan.rent, travelCost: plan.travelCost, extraCost: plan.extraCost, extraCostNote: plan.extraCostNote,
    status: plan.status, version: plan.version, closedAt: plan.closedAt,
    items: plan.items.map((item) => {
      const row = stock.find((p) => p.productId === String(item.product));
      const prepared = item.batches.reduce((n, b) => n + b.quantity, 0);
      const cost = item.batches.reduce((n, b) => n.add(new Decimal(b.unitCost).mul(b.quantity)), new Decimal(0));
      const stockOut = (row?.sold || 0) + (row?.unpaidHandovers || 0) + (row?.refundedHandovers || 0);
      return { productId: String(item.product), name: item.name, prepared,
        wasted: row?.wasted ?? Math.max(0, prepared - stockOut + item.returned - item.reusable),
        reusable: item.reusable, returned: item.returned, stockOut, refundedHandovers: row?.refundedHandovers || 0,
        unitCost: prepared ? cost.div(prepared).toDecimalPlaces(2).toNumber() : null };
    }) };
}
async function input(body, previous, session) {
  if (!body || typeof body !== 'object') throw ApiError.badRequest('Enter event details');
  const name = previous?.eventName || (typeof body.eventName === 'string' ? eventNameOf(body.eventName) : '');
  if (!name || name.length > 120) throw ApiError.badRequest('Enter an event name of up to 120 characters');
  if (previous && body.eventName !== undefined && (typeof body.eventName !== 'string' || eventKeyOf(body.eventName) !== previous.eventKey)) throw ApiError.badRequest('The event name cannot change after it has been saved');
  const startDate = date(body.startDate, 'start date');
  const endDate = date(body.endDate, 'end date') || startDate;
  if (!startDate || endDate < startDate) throw ApiError.badRequest('Choose event dates with the end on or after the start');
  const rent = amount(body.rent ?? 0, 'Rent');
  const travelCost = amount(body.travelCost ?? 0, 'Car / travel cost');
  const extraCost = amount(body.extraCost ?? 0, 'Extra cost');
  if (body.extraCostNote !== undefined && (typeof body.extraCostNote !== 'string' || body.extraCostNote.length > 1000)) throw ApiError.badRequest('Extra cost notes must be up to 1,000 characters');
  if (!Array.isArray(body.items) || body.items.length > 100) throw ApiError.badRequest('Add up to 100 products');
  const seen = new Set();
  for (const item of body.items) {
    if (!item || !mongoose.isValidObjectId(item.productId)) throw ApiError.badRequest('Choose a valid product');
    if (seen.has(String(item.productId))) throw ApiError.badRequest('Add each product only once');
    seen.add(String(item.productId));
    count(item.prepared, 'Prepared pieces', 1); count(item.wasted ?? 0, 'Wasted pieces');
    count(item.reusable ?? 0, 'Reusable pieces'); count(item.returned ?? 0, 'Returned pieces');
  }
  const products = await Product.find({ _id: { $in: [...seen] } }).session(session).lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const old = new Map((previous?.items || []).map((i) => [String(i.product), i]));
  const growing = body.items.filter((i) => i.prepared > (old.get(String(i.productId))?.batches.reduce((n, b) => n + b.quantity, 0) || 0));
  const costs = await linkedCosts(growing.map((i) => i.productId), session);
  const items = body.items.map((item) => {
    const id = String(item.productId); const product = productMap.get(id); const saved = old.get(id);
    if (!saved && (!product || product.archived || (!product.available && !product.stockSoldOut))) throw ApiError.badRequest('Choose products available in Products');
    let batches = (saved?.batches || []).map((b) => ({ ...b }));
    const before = batches.reduce((n, b) => n + b.quantity, 0);
    if (item.prepared > before) {
      if (!product || product.archived || (!product.available && !product.stockSoldOut)) throw ApiError.badRequest('Make the product available in Products before adding more prepared pieces');
      const recipe = costs.get(id);
      if (!recipe || recipe.error || recipe.unitCost == null) throw ApiError.badRequest(`Link a valid recipe for ${product?.name || saved.name} in Product mapping before adding prepared pieces`);
      batches.push({ quantity: item.prepared - before, unitCost: recipe.unitCost, recipeId: recipe.recipeId, recipeVersion: recipe.version, recordedAt: new Date() });
    } else if (item.prepared < before) {
      let remove = before - item.prepared;
      while (remove > 0) {
        const last = batches[batches.length - 1]; const take = Math.min(remove, last.quantity);
        last.quantity -= take; remove -= take; if (!last.quantity) batches.pop();
      }
    }
    return { product: id, name: saved?.name || product.name, batches,
      wasted: 0, reusable: item.reusable || 0, returned: item.returned || 0,
      stockNeedsRestore: saved?.stockNeedsRestore || false };
  });
  return { eventName: name, eventKey: eventKeyOf(name), startDate, endDate, rent, travelCost, extraCost,
    extraCostNote: (body.extraCostNote || '').trim(), items };
}

const products = asyncHandler(async (req, res) => {
  const available = await Product.find({ archived: { $ne: true }, $or: [{ available: true }, { stockSoldOut: true }] }).sort({ name: 1 }).select('name').lean();
  const costs = await linkedCosts(available.map((p) => p._id));
  res.json({ success: true, products: available.map((p) => ({ _id: String(p._id), name: p.name,
    unitCost: costs.get(String(p._id))?.unitCost == null ? null : Number(costs.get(String(p._id)).unitCost),
    recipeName: costs.get(String(p._id))?.recipeName || null })) });
});
const get = asyncHandler(async (req, res) => {
  const plan = await EventPlan.findById(idOf(req.params.id)).lean();
  if (!plan) throw ApiError.notFound('Event not found');
  const report = await eventSalesReport({ eventName: plan.eventName });
  res.json({ success: true, plan: planView(plan, report.stock) });
});
const save = asyncHandler(async (req, res) => {
  const isUpdate = !!req.params.id;
  const { plan: result, stock } = await transaction(async (session) => {
    let previous;
    if (isUpdate) {
      previous = await EventPlan.findById(idOf(req.params.id)).session(session).lean();
      if (!previous) throw ApiError.notFound('Event not found');
      if (previous.status === 'closed') throw ApiError.conflict('Reopen this event before changing its stock or expenses');
      if (previous.version !== versionOf(req.body)) throw ApiError.conflict('This event changed. Reload its details before saving');
    }
    const data = await input(req.body, previous, session);
    if (!isUpdate && await EventPlan.exists({ eventKey: data.eventKey }).session(session)) throw ApiError.conflict('An event with this name already exists. Use a distinct name for another edition');
    const plan = isUpdate
      ? await EventPlan.findOneAndUpdate({ _id: previous._id, version: previous.version, status: 'open' }, { $set: data, $inc: { version: 1 } }, { session, new: true, runValidators: true })
      : (await EventPlan.create([data], { session }))[0];
    if (!plan) throw ApiError.conflict('This event changed. Reload before saving');
    const report = await eventSalesReport({ eventName: plan.eventName, session });
    const invalid = report.stock.find((p) => p.remaining !== null && p.remaining < 0 || p.returned > p.refundedHandovers);
    if (invalid) throw ApiError.badRequest(`Check ${invalid.name}: prepared pieces must cover sales, handovers, wastage and reusable stock. Returned pieces cannot exceed refunded handovers`);
    await syncPreparedStock(previous, plan, report.stock, session);
    return { plan, stock: report.stock };
  });
  audit(req, { action: isUpdate ? 'event.update' : 'event.create', entity: 'event', entityId: result._id,
    summary: `${isUpdate ? 'Updated' : 'Created'} ${result.eventName}: preparation and expenses` });
  res.status(isUpdate ? 200 : 201).json({ success: true, plan: planView(result.toObject(), stock) });
});
const close = asyncHandler(async (req, res) => {
  const result = await transaction(async (session) => {
    const plan = await EventPlan.findById(idOf(req.params.id)).session(session).lean();
    if (!plan) throw ApiError.notFound('Event not found');
    if (plan.version !== versionOf(req.body) || plan.status !== 'open') throw ApiError.conflict('This event changed. Reload before closing');
    const report = await eventSalesReport({ eventName: plan.eventName, session, useFinal: false });
    const event = report.events[0];
    if (req.body.revision !== undefined && req.body.revision !== event.revision) throw ApiError.conflict('Orders changed since you reviewed this report. Refresh and review the totals before closing');
    if (event.openOrders) throw ApiError.badRequest('Complete or cancel remaining event orders before closing');
    if (report.stock.some((p) => p.unpaidHandovers)) throw ApiError.badRequest('Settle unpaid handovers before closing the event');
    if (!event.stockReconciled) throw ApiError.badRequest('Enter prepared quantities for every sold product and check reusable and returned counts');
    if (event.netProfit === null) throw ApiError.badRequest('Resolve missing recipe costs before closing the event');
    const closed = await EventPlan.findOneAndUpdate({ _id: plan._id, version: plan.version, status: 'open' }, {
      $set: { status: 'closed', closedAt: new Date(), closedBy: req.user._id, finalReport: { event, products: report.products, stock: report.stock } }, $inc: { version: 1 },
    }, { session, new: true });
    if (!closed) throw ApiError.conflict('This event changed. Reload before closing');
    return closed;
  });
  audit(req, { action: 'event.close', entity: 'event', entityId: result._id, summary: `Closed ${result.eventName}: net profit ₹${result.finalReport.event.netProfit}` });
  res.json({ success: true, plan: planView(result.toObject()) });
});
const reopen = asyncHandler(async (req, res) => {
  const plan = await EventPlan.findOneAndUpdate({ _id: idOf(req.params.id), status: 'closed', version: versionOf(req.body) }, {
    $set: { status: 'open', closedAt: null, closedBy: null, finalReport: null }, $inc: { version: 1 },
  }, { new: true });
  if (!plan) throw ApiError.conflict('This event changed. Reload before reopening');
  audit(req, { action: 'event.reopen', entity: 'event', entityId: plan._id, summary: `Reopened ${plan.eventName} for corrections` });
  const report = await eventSalesReport({ eventName: plan.eventName });
  res.json({ success: true, plan: planView(plan.toObject(), report.stock) });
});

module.exports = { options, products, get, save, close, reopen };
