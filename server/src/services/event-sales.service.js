const Decimal = require('decimal.js');
const Order = require('../models/Order');
const EventPlan = require('../models/EventPlan');
const ApiError = require('../utils/ApiError');
const { linkedCosts } = require('./recipe-product.service');

const eventNameOf = (name) => name.trim().replace(/\s+/g, ' ');
const eventKeyOf = (name) => eventNameOf(name).toLowerCase();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eventMatch = (name) => ({ source: 'event', ...(name ? { eventName: new RegExp(`^${escapeRegex(eventNameOf(name))}$`, 'i') } : {}) });
const money = (value) => new Decimal(value).toDecimalPlaces(2).toNumber();
const addCost = (total, value) => total === null || value === null ? null : total.add(value);

async function assertEventOpen(order, session) {
  if (order.source !== 'event') return;
  const plan = await EventPlan.findOne({ eventKey: eventKeyOf(order.eventName) }).session(session || null).select('status').lean();
  if (plan?.status === 'closed') throw ApiError.conflict('This event is closed. Reopen it in Event sales before changing its orders.');
}

function stockFor(plan, sales) {
  const items = new Map(plan.items.map((item) => [String(item.product), item]));
  const ids = new Set([...items.keys(), ...sales.keys()]);
  return [...ids].map((id) => {
    const item = items.get(id);
    const sale = sales.get(id);
    const prepared = item ? item.batches.reduce((n, b) => n + b.quantity, 0) : null;
    const preparedCost = item ? item.batches.reduce((n, b) => n.add(new Decimal(b.unitCost).mul(b.quantity)), new Decimal(0)) : null;
    const unitCost = prepared ? preparedCost.div(prepared) : null;
    const sold = sale?.quantity || 0;
    const unpaidHandovers = sale?.unpaidHandovers || 0;
    const refundedHandovers = sale?.refundedHandovers || 0;
    const otherHandovers = unpaidHandovers + refundedHandovers;
    const returned = item?.returned || 0;
    const reusable = item?.reusable || 0;
    const wasted = prepared === null ? 0 : Math.max(0, prepared - sold - otherHandovers + returned - reusable);
    const remaining = prepared === null ? null : prepared - sold - otherHandovers + returned - wasted - reusable;
    // Returned refunded pieces are valued as stock again. Refunded pieces kept by
    // the customer are a loss; they must not disappear from the event's expenses.
    const refundLoss = refundedHandovers > returned
      ? sale.refundCost === null ? null : sale.refundCost.mul(refundedHandovers - returned).div(refundedHandovers)
      : new Decimal(0);
    const handoverLossCost = addCost(sale ? sale.unpaidCost : new Decimal(0), refundLoss);
    return {
      eventName: plan.eventName, productId: id, name: item?.name || sale?.name,
      prepared, sold, handedOver: (sale?.completedPaid || 0) + otherHandovers,
      unpaidHandovers, refundedHandovers, returned, wasted, reusable, remaining,
      unitCost: unitCost === null ? null : money(unitCost),
      preparedCost: preparedCost === null ? null : money(preparedCost),
      wastageCost: unitCost === null ? null : money(unitCost.mul(wasted)),
      reusableValue: unitCost === null ? null : money(unitCost.mul(reusable)),
      handoverLossCost: handoverLossCost === null ? null : money(handoverLossCost),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function eventSalesReport({ eventName = '', session = null, useFinal = true } = {}) {
  const match = eventMatch(eventName);
  const paid = { $and: [{ $eq: ['$paymentStatus', 'paid'] }, { $ne: ['$orderStatus', 'cancelled'] }] };
  const pending = { $and: [{ $eq: ['$paymentStatus', 'pending'] }, { $ne: ['$orderStatus', 'cancelled'] }] };
  const receivedBy = (method) => ({ $sum: { $cond: [{ $and: [paid, { $eq: ['$paymentMethod', method] }] }, '$pricing.total', 0] } });
  // Run sequentially in a transaction: MongoDB sessions do not support parallel operations.
  const plans = await EventPlan.find().session(session).lean();
  const events = await Order.aggregate([
    { $match: match },
    { $group: { _id: { $toLower: '$eventName' }, eventName: { $last: '$eventName' }, orders: { $sum: 1 },
      paidOrders: { $sum: { $cond: [paid, 1, 0] } }, revenue: { $sum: { $cond: [paid, '$pricing.total', 0] } },
      units: { $sum: { $cond: [paid, { $sum: '$items.quantity' }, 0] } },
      pendingAmount: { $sum: { $cond: [pending, '$pricing.total', 0] } },
      openOrders: { $sum: { $cond: [{ $in: ['$orderStatus', ['placed', 'confirmed', 'preparing', 'ready']] }, 1, 0] } },
      cash: receivedBy('cash'), upi: receivedBy('upi'), card: receivedBy('card'),
      lastSaleAt: { $max: '$createdAt' }, lastOrderUpdate: { $max: '$updatedAt' } } },
    { $sort: { lastSaleAt: -1 } },
  ]).session(session);
  const rows = await Order.aggregate([
    { $match: { ...match, orderStatus: { $ne: 'cancelled' } } }, { $unwind: '$items' },
    { $set: { soldUnitCost: { $let: { vars: { snapshot: { $arrayElemAt: [{ $filter: {
      input: { $ifNull: ['$recipeCostSnapshot', []] }, as: 'cost', cond: { $eq: ['$$cost.product', '$items.product'] },
    } }, 0] } }, in: { $ifNull: ['$$snapshot.unitCost', null] } } } } },
    { $group: { _id: { product: '$items.product', event: { $toLower: '$eventName' }, unitCost: '$soldUnitCost', payment: '$paymentStatus', status: '$orderStatus' },
      name: { $last: '$items.name' }, quantity: { $sum: '$items.quantity' }, subtotal: { $sum: '$items.lineTotal' } } },
  ]).session(session);
  const names = await Order.aggregate([
    { $match: { source: 'event' } }, { $group: { _id: { $toLower: '$eventName' }, name: { $last: '$eventName' } } },
  ]).session(session);
  const recipes = await linkedCosts(rows.filter((p) => p._id.unitCost == null).map((p) => p._id.product), session);
  const salesByEvent = new Map();
  for (const row of rows) {
    const isPaid = row._id.payment === 'paid';
    const isOther = row._id.status === 'completed' && !isPaid;
    if (!isPaid && !isOther) continue;
    const key = eventKeyOf(row._id.event);
    const sales = salesByEvent.get(key) || new Map();
    const id = String(row._id.product);
    const p = sales.get(id) || { _id: id, name: row.name, quantity: 0, subtotal: new Decimal(0), cost: new Decimal(0),
      estimated: false, completedPaid: 0, unpaidHandovers: 0, refundedHandovers: 0, unpaidCost: new Decimal(0), refundCost: new Decimal(0) };
    const unitCost = row._id.unitCost ?? recipes.get(id)?.unitCost;
    const cost = unitCost == null ? null : new Decimal(unitCost).mul(row.quantity);
    if (isPaid) {
      p.quantity += row.quantity;
      p.subtotal = p.subtotal.add(row.subtotal);
      p.cost = addCost(p.cost, cost);
      p.estimated ||= row._id.unitCost == null;
      if (row._id.status === 'completed') p.completedPaid += row.quantity;
    } else if (row._id.payment === 'refunded') {
      p.refundedHandovers += row.quantity; p.refundCost = addCost(p.refundCost, cost);
    } else {
      p.unpaidHandovers += row.quantity; p.unpaidCost = addCost(p.unpaidCost, cost);
    }
    sales.set(id, p); salesByEvent.set(key, sales);
  }
  const eventMap = new Map(events.map((e) => [eventKeyOf(e.eventName), e]));
  for (const plan of plans) {
    if (eventName && plan.eventKey !== eventKeyOf(eventName)) continue;
    if (!eventMap.has(plan.eventKey)) eventMap.set(plan.eventKey, { eventName: plan.eventName, orders: 0, paidOrders: 0, units: 0,
      revenue: 0, pendingAmount: 0, openOrders: 0, cash: 0, upi: 0, card: 0, lastSaleAt: null, lastOrderUpdate: null });
  }
  const planMap = new Map(plans.map((p) => [p.eventKey, p]));
  const result = []; const stock = []; const productTotals = new Map();
  for (const [key, source] of eventMap) {
    const plan = planMap.get(key);
    const sales = salesByEvent.get(key) || new Map();
    const cost = [...sales.values()].reduce((n, p) => addCost(n, p.cost), new Decimal(0));
    let event = { ...source, _id: undefined, planId: plan ? String(plan._id) : null, version: plan?.version ?? null,
      eventName: plan?.eventName || source.eventName, cost: cost === null ? null : money(cost),
      costEstimated: [...sales.values()].some((p) => p.estimated),
      revenue: money(source.revenue), pendingAmount: money(source.pendingAmount), cash: money(source.cash), upi: money(source.upi), card: money(source.card),
      status: plan?.status || 'unconfigured', startDate: plan?.startDate || '', endDate: plan?.endDate || '',
      rent: plan?.rent ?? null, travelCost: plan?.travelCost ?? null, extraCost: plan?.extraCost ?? null,
      extraCostNote: plan?.extraCostNote || '', closedAt: plan?.closedAt || null,
      profit: cost === null ? null : money(new Decimal(source.revenue).sub(money(cost))),
      netProfit: null, preparedUnits: null, wastedUnits: null, reusableUnits: null,
      preparedCost: null, wastageCost: null, handoverLossCost: null, reusableValue: null, stockReconciled: false, changedSinceClose: false,
      revision: `${source.orders}/${source.lastOrderUpdate ? new Date(source.lastOrderUpdate).toISOString() : ''}` };
    let products = [...sales.values()].filter((p) => p.quantity > 0).map((p) => ({ _id: p._id, name: p.name, quantity: p.quantity,
      cost: p.cost === null ? null : money(p.cost), costEstimated: p.estimated, subtotal: money(p.subtotal) }));
    let eventStock = stockFor(plan || { eventName: source.eventName, items: [] }, sales);
    if (plan) {
      event.preparedUnits = eventStock.reduce((n, p) => n + (p.prepared || 0), 0);
      event.wastedUnits = eventStock.reduce((n, p) => n + p.wasted, 0);
      event.reusableUnits = eventStock.reduce((n, p) => n + p.reusable, 0);
      event.preparedCost = eventStock.some((p) => p.preparedCost === null) ? null : money(eventStock.reduce((n, p) => n.add(p.preparedCost), new Decimal(0)));
      event.reusableValue = eventStock.some((p) => p.reusableValue === null) ? null : money(eventStock.reduce((n, p) => n.add(p.reusableValue), new Decimal(0)));
      event.handoverLossCost = eventStock.some((p) => p.handoverLossCost === null) ? null : money(eventStock.reduce((n, p) => n.add(p.handoverLossCost), new Decimal(0)));
      event.wastageCost = eventStock.some((p) => p.wastageCost === null || p.handoverLossCost === null) ? null : money(eventStock.reduce((n, p) => n.add(p.wastageCost).add(p.handoverLossCost), new Decimal(0)));
      event.stockReconciled = eventStock.every((p) => p.remaining === 0 && p.returned <= p.refundedHandovers);
      if (event.stockReconciled && event.profit !== null && event.wastageCost !== null) {
        event.netProfit = money(new Decimal(event.profit).sub(event.wastageCost).sub(plan.rent).sub(plan.travelCost).sub(plan.extraCost));
      }
    }
    if (useFinal && plan?.status === 'closed' && plan.finalReport) {
      const changed = event.revision !== plan.finalReport.event.revision;
      event = { ...plan.finalReport.event, planId: String(plan._id), version: plan.version, status: 'closed', closedAt: plan.closedAt, changedSinceClose: changed };
      products = plan.finalReport.products; eventStock = plan.finalReport.stock;
    }
    result.push(event); stock.push(...eventStock);
    const eventProducts = new Map(products.map((p) => [String(p._id), p]));
    const productStock = new Map(eventStock.map((p) => [String(p.productId), p]));
    for (const row of eventStock) if (!eventProducts.has(String(row.productId))) {
      eventProducts.set(String(row.productId), { _id: row.productId, name: row.name, quantity: row.sold, subtotal: 0, cost: 0, costEstimated: false });
    }
    for (const p of eventProducts.values()) {
      const prepared = productStock.get(String(p._id));
      const total = productTotals.get(String(p._id)) || { ...p, quantity: 0, subtotal: new Decimal(0), cost: new Decimal(0), costEstimated: false,
        totalUnits: 0, totalCost: new Decimal(0), wastageCost: new Decimal(0) };
      total.quantity += p.quantity; total.subtotal = total.subtotal.add(p.subtotal);
      total.cost = addCost(total.cost, p.cost === null ? null : new Decimal(p.cost));
      total.totalUnits = total.totalUnits === null || prepared?.prepared == null ? null : total.totalUnits + prepared.prepared;
      total.totalCost = addCost(total.totalCost, prepared?.preparedCost == null ? null : new Decimal(prepared.preparedCost));
      const loss = !prepared || prepared.remaining !== 0 || prepared.wastageCost === null || prepared.handoverLossCost === null
        ? null : new Decimal(prepared.wastageCost).add(prepared.handoverLossCost);
      total.wastageCost = addCost(total.wastageCost, loss);
      total.costEstimated ||= p.costEstimated; productTotals.set(String(p._id), total);
    }
  }
  result.sort((a, b) => (b.startDate || b.lastSaleAt || '').toString().localeCompare((a.startDate || a.lastSaleAt || '').toString()));
  return { events: result, stock, products: [...productTotals.values()].sort((a, b) => b.quantity - a.quantity).map((p) => ({ ...p,
    cost: p.cost === null ? null : money(p.cost), subtotal: money(p.subtotal), totalCost: p.totalCost === null ? null : money(p.totalCost),
    wastageCost: p.wastageCost === null ? null : money(p.wastageCost),
    profit: p.totalCost === null ? null : money(new Decimal(money(p.subtotal)).sub(money(p.totalCost))) })),
    eventNames: [...new Map([...names.map((n) => [eventKeyOf(n.name), n.name]), ...plans.map((p) => [p.eventKey, p.eventName])]).values()].sort((a, b) => a.localeCompare(b)) };
}

module.exports = { eventNameOf, eventKeyOf, eventSalesReport, assertEventOpen };
