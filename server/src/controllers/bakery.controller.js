const BakeryMaterial = require('../models/BakeryMaterial');
const BakeryRecipe = require('../models/BakeryRecipe');
const BakeryProduction = require('../models/BakeryProduction');
const BakeryWaste = require('../models/BakeryWaste');
const costEngine = require('../services/bakeryCost.service');
const ApiError = require('../utils/ApiError');

// Helper to get materials map
async function getMaterialMap() {
  const materials = await BakeryMaterial.find({ isActive: true });
  const map = new Map();
  for (const m of materials) {
    map.set(String(m._id), m);
  }
  return map;
}

// Helper to get sub-recipes map
async function getSubRecipeMap() {
  const subRecipes = await BakeryRecipe.find({ isSubRecipe: true, isActive: true });
  const map = new Map();
  for (const r of subRecipes) {
    map.set(String(r._id), r);
  }
  return map;
}

/* =========================================================================
   MATERIALS
   ========================================================================= */

exports.getMaterials = async (req, res, next) => {
  try {
    const { type, category, search } = req.query;
    const query = { isActive: true };

    if (type) query.type = type;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }

    const materials = await BakeryMaterial.find(query).sort({ category: 1, name: 1 });
    res.json({ success: true, count: materials.length, materials });
  } catch (err) {
    next(err);
  }
};

exports.createMaterial = async (req, res, next) => {
  try {
    const data = req.body;
    // Calculate effective unit cost automatically
    data.effectiveUnitCost = costEngine.calculateEffectiveUnitCost(
      data.packQuantity,
      data.packUom,
      data.purchasePrice,
      data.baseUom,
      data.densityGramPerMl,
    );

    const material = await BakeryMaterial.create(data);
    res.status(201).json({ success: true, material });
  } catch (err) {
    next(err);
  }
};

exports.updateMaterial = async (req, res, next) => {
  try {
    const data = req.body;
    // Recalculate effective unit cost
    if (data.packQuantity !== undefined || data.purchasePrice !== undefined || data.packUom !== undefined || data.baseUom !== undefined) {
      data.effectiveUnitCost = costEngine.calculateEffectiveUnitCost(
        data.packQuantity,
        data.packUom,
        data.purchasePrice,
        data.baseUom,
        data.densityGramPerMl,
      );
    }

    const material = await BakeryMaterial.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!material) throw ApiError.notFound('Material not found');

    res.json({ success: true, material });
  } catch (err) {
    next(err);
  }
};

exports.deleteMaterial = async (req, res, next) => {
  try {
    const material = await BakeryMaterial.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!material) throw ApiError.notFound('Material not found');
    res.json({ success: true, message: 'Material archived' });
  } catch (err) {
    next(err);
  }
};

/* =========================================================================
   RECIPES
   ========================================================================= */

exports.getRecipes = async (req, res, next) => {
  try {
    const { category, search, isSubRecipe } = req.query;
    const query = { isActive: true };

    if (category) query.category = category;
    if (isSubRecipe !== undefined) query.isSubRecipe = isSubRecipe === 'true';
    if (search) query.name = { $regex: search, $options: 'i' };

    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();

    const recipes = await BakeryRecipe.find(query).sort({ category: 1, name: 1 });

    // Ensure live recalculated cost is always fresh
    const enriched = recipes.map((r) => {
      const evaluated = costEngine.evaluateRecipeCost(r, materialMap, subRecipeMap);
      return {
        ...r.toObject(),
        ingredientCost: evaluated.ingredientCost,
        packagingCost: evaluated.packagingCost,
        labourCost: evaluated.labourCost,
        resourceCost: evaluated.resourceCost,
        totalBatchCost: evaluated.totalBatchCost,
        costPerUnit: evaluated.costPerUnit,
        suggestedSellingPrice: evaluated.suggestedSellingPrice,
      };
    });

    res.json({ success: true, count: enriched.length, recipes: enriched });
  } catch (err) {
    next(err);
  }
};

exports.getRecipeById = async (req, res, next) => {
  try {
    const recipe = await BakeryRecipe.findById(req.params.id);
    if (!recipe || !recipe.isActive) throw ApiError.notFound('Recipe not found');

    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();
    const evaluated = costEngine.evaluateRecipeCost(recipe, materialMap, subRecipeMap);

    res.json({
      success: true,
      recipe: {
        ...recipe.toObject(),
        ...evaluated,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createRecipe = async (req, res, next) => {
  try {
    const data = req.body;
    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();

    const evaluated = costEngine.evaluateRecipeCost(data, materialMap, subRecipeMap);
    Object.assign(data, evaluated);

    const recipe = await BakeryRecipe.create(data);
    res.status(201).json({ success: true, recipe });
  } catch (err) {
    next(err);
  }
};

exports.updateRecipe = async (req, res, next) => {
  try {
    const data = req.body;
    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();

    const evaluated = costEngine.evaluateRecipeCost(data, materialMap, subRecipeMap);
    Object.assign(data, evaluated);

    const recipe = await BakeryRecipe.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!recipe) throw ApiError.notFound('Recipe not found');

    res.json({ success: true, recipe });
  } catch (err) {
    next(err);
  }
};

exports.deleteRecipe = async (req, res, next) => {
  try {
    const recipe = await BakeryRecipe.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!recipe) throw ApiError.notFound('Recipe not found');
    res.json({ success: true, message: 'Recipe archived' });
  } catch (err) {
    next(err);
  }
};

/* =========================================================================
   CALCULATOR & SIMULATION
   ========================================================================= */

// Single recipe instant scaling (e.g. 7 Butter Cakes)
exports.simulateRecipe = async (req, res, next) => {
  try {
    const { recipeId, quantity, targetMarkup } = req.body;
    if (!recipeId) throw ApiError.badRequest('Recipe ID required');

    const recipe = await BakeryRecipe.findById(recipeId);
    if (!recipe) throw ApiError.notFound('Recipe not found');

    if (targetMarkup !== undefined) {
      recipe.targetMarkupPercent = Number(targetMarkup);
    }

    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();

    const scaled = costEngine.scaleRecipeForQuantity(recipe, quantity || 1, materialMap, subRecipeMap);
    res.json({ success: true, scaled });
  } catch (err) {
    next(err);
  }
};

// Multi-product simulation & kitchen prep aggregation
exports.simulateMultiProduct = async (req, res, next) => {
  try {
    const { items, targetMarkup } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      throw ApiError.badRequest('At least one recipe item is required');
    }

    const materialMap = await getMaterialMap();
    const subRecipeMap = await getSubRecipeMap();

    // Fetch recipes
    const populatedPlans = [];
    for (const item of items) {
      const recipe = await BakeryRecipe.findById(item.recipeId);
      if (recipe) {
        populatedPlans.push({
          recipe,
          quantity: Number(item.quantity) || 1,
        });
      }
    }

    const aggregated = costEngine.aggregateMultiProductRequirements(populatedPlans, materialMap, subRecipeMap);
    const markup = targetMarkup !== undefined ? Number(targetMarkup) : 50;
    const pricing = costEngine.calculatePricing(aggregated.totalCost, markup);

    res.json({
      success: true,
      aggregated: {
        ...aggregated,
        markupPercent: markup,
        suggestedSellingPrice: pricing.suggestedSellingPrice,
        profit: pricing.profit,
        marginPercent: pricing.marginPercent,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================================================
   SAVED PRODUCTION PLANS & COSTING SHEETS
   ========================================================================= */

exports.getCostingSheets = async (req, res, next) => {
  try {
    const { type } = req.query;
    const query = {};
    if (type) query.type = type;

    const sheets = await BakeryProduction.find(query).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, count: sheets.length, sheets });
  } catch (err) {
    next(err);
  }
};

exports.saveCostingSheet = async (req, res, next) => {
  try {
    const data = req.body;
    const code = 'PLN-' + Date.now().toString().slice(-6);
    data.code = code;

    const sheet = await BakeryProduction.create(data);
    res.status(201).json({ success: true, sheet });
  } catch (err) {
    next(err);
  }
};

/* =========================================================================
   INVENTORY & SHORTAGES
   ========================================================================= */

exports.getInventoryStatus = async (req, res, next) => {
  try {
    const materials = await BakeryMaterial.find({ isActive: true }).sort({ category: 1, name: 1 });

    const lowStock = materials.filter((m) => m.currentStock <= (m.reorderLevel || m.minimumStock || 0));

    res.json({
      success: true,
      count: materials.length,
      materials,
      lowStockCount: lowStock.length,
      lowStock,
    });
  } catch (err) {
    next(err);
  }
};

exports.updateStock = async (req, res, next) => {
  try {
    const { currentStock, adjustment } = req.body;
    const material = await BakeryMaterial.findById(req.params.id);
    if (!material) throw ApiError.notFound('Material not found');

    if (currentStock !== undefined) {
      material.currentStock = Math.max(0, Number(currentStock));
    } else if (adjustment !== undefined) {
      material.currentStock = Math.max(0, material.currentStock + Number(adjustment));
    }

    await material.save();
    res.json({ success: true, material });
  } catch (err) {
    next(err);
  }
};

/* =========================================================================
   WASTE LOG
   ========================================================================= */

exports.getWasteLogs = async (req, res, next) => {
  try {
    const logs = await BakeryWaste.find().sort({ date: -1 }).limit(100);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayCost = logs
      .filter((l) => new Date(l.date) >= startOfToday)
      .reduce((sum, l) => sum + (l.totalCostLost || 0), 0);

    const monthCost = logs
      .filter((l) => new Date(l.date) >= startOfMonth)
      .reduce((sum, l) => sum + (l.totalCostLost || 0), 0);

    res.json({
      success: true,
      count: logs.length,
      todayCost,
      monthCost,
      logs,
    });
  } catch (err) {
    next(err);
  }
};

exports.logWaste = async (req, res, next) => {
  try {
    const { materialId, quantity, reason, notes } = req.body;
    let materialName = req.body.materialName || 'Custom Item';
    let uom = req.body.uom || 'g';
    let unitCost = Number(req.body.unitCost) || 0;

    if (materialId) {
      const mat = await BakeryMaterial.findById(materialId);
      if (mat) {
        materialName = mat.name;
        uom = mat.baseUom;
        unitCost = mat.effectiveUnitCost;

        // Optionally deduct from on-hand stock
        mat.currentStock = Math.max(0, mat.currentStock - (Number(quantity) || 0));
        await mat.save();
      }
    }

    const totalCostLost = (Number(quantity) || 0) * unitCost;

    const waste = await BakeryWaste.create({
      materialId: materialId || null,
      materialName,
      quantity: Number(quantity) || 0,
      uom,
      unitCost,
      totalCostLost,
      reason: reason || 'Spoilage',
      notes: notes || '',
      date: new Date(),
    });

    res.status(201).json({ success: true, waste });
  } catch (err) {
    next(err);
  }
};
