const mongoose = require('mongoose');
const Customer = require('../models/SaasCustomer');
const Waste = require('../models/SaasWaste');
const MaterialMovement = require('../models/SaasMaterialMovement');
const Production = require('../models/SaasProductionRun');
const Product = require('../models/SaasProduct');
const Material = require('../models/SaasMaterial');
const Recipe = require('../models/SaasRecipe');
const Event = require('../models/SaasEvent');
const Order = require('../models/SaasOrder');
const Bakery = require('../models/Bakery');
const { subscriptionPolicy } = require('../saas/plan-policy');
const { fields } = require('../saas/recipe-input');
const asyncHandler = require('../utils/asyncHandler');
const get = asyncHandler(async (req, res) => {
  fields(req.query, []);
  const session = await mongoose.startSession(); let usage, policy;
  try {
    await session.withTransaction(async () => {
      const bakery = await Bakery.findById(req.bakeryContext.bakeryId).session(session).lean();
      policy = subscriptionPolicy(bakery.subscription); usage = {};
      // Operations on a MongoDB transaction session must remain sequential.
      for (const [resource, Model] of Object.entries({ products: Product, materials: Material, recipes: Recipe, events: Event, orders: Order, productionRuns: Production, materialMovements: MaterialMovement, wasteEntries: Waste, customers: Customer })) {
        usage[resource] = { used: await Model.countDocuments({ bakeryId: req.bakeryContext.bakeryId }).session(session), limit: policy.limits[resource] };
      }
    }, { readConcern: { level: 'snapshot' } });
  } finally { await session.endSession(); }
  res.json({ success: true, policy: policy.policy, usage, revisionsPerRecipeLimit: policy.limits.revisionsPerRecipe });
});
module.exports = { get };
