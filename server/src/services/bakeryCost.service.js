/**
 * Centralised Authoritative Costing & Bakery Calculations Engine
 * High-speed, robust calculations for pack conversions, recipe costing,
 * batch scaling, stepped capacity, and markup/margin pricing.
 */

/**
 * Standardise unit conversions safely
 */
function convertUnits(quantity, fromUom, toUom, density = 1.0) {
  const qty = Number(quantity) || 0;
  if (fromUom === toUom) return qty;

  const f = String(fromUom).toLowerCase();
  const t = String(toUom).toLowerCase();
  const d = Number(density) > 0 ? Number(density) : 1.0;

  // Mass <-> Mass
  if ((f === 'kg' || f === 'kilogram') && (t === 'g' || t === 'gram' || t === 'gm')) return qty * 1000;
  if ((f === 'g' || f === 'gram' || f === 'gm') && (t === 'kg' || t === 'kilogram')) return qty / 1000;
  if (f === 'mg' && (t === 'g' || t === 'gram' || t === 'gm')) return qty / 1000;
  if ((f === 'g' || f === 'gram' || f === 'gm') && t === 'mg') return qty * 1000;

  // Volume <-> Volume
  if ((f === 'l' || f === 'litre' || f === 'liter') && (t === 'ml' || t === 'millilitre')) return qty * 1000;
  if ((f === 'ml' || f === 'millilitre') && (t === 'l' || t === 'litre' || t === 'liter')) return qty / 1000;

  // Mass <-> Volume (density = grams per ml)
  // e.g. 1 ml water = 1 g, milk ~ 1.03 g/ml, oil ~ 0.92 g/ml
  if ((f === 'ml' || f === 'millilitre') && (t === 'g' || t === 'gram' || t === 'gm')) return qty * d;
  if ((f === 'g' || f === 'gram' || f === 'gm') && (t === 'ml' || t === 'millilitre')) return qty / d;
  if ((f === 'l' || f === 'litre' || f === 'liter') && (t === 'g' || t === 'gram' || t === 'gm')) return (qty * 1000) * d;
  if ((f === 'kg' || f === 'kilogram') && (t === 'ml' || t === 'millilitre')) return (qty * 1000) / d;

  // Count
  if (f === 'dozen' && (t === 'piece' || t === 'pcs' || t === 'pc')) return qty * 12;
  if ((f === 'piece' || f === 'pcs' || f === 'pc') && t === 'dozen') return qty / 12;

  // Time
  if (f === 'hour' && (t === 'minute' || t === 'min')) return qty * 60;
  if ((f === 'minute' || f === 'min') && t === 'hour') return qty / 60;

  // Fallback direct quantity if unknown cross-type conversion
  return qty;
}

/**
 * Calculates effective unit cost in material's base UOM.
 * E.g., Butter: 500 g @ ₹310 -> ₹0.62 / g
 * E.g., Cocoa: 225 g @ ₹330 -> ₹1.466666667 / g
 */
function calculateEffectiveUnitCost(packQuantity, packUom, purchasePrice, baseUom, density = 1.0) {
  const packQty = Number(packQuantity) || 1;
  const price = Number(purchasePrice) || 0;
  const qtyInBaseUom = convertUnits(packQty, packUom, baseUom, density);
  if (qtyInBaseUom <= 0) return 0;
  return price / qtyInBaseUom;
}

/**
 * Calculates pricing, profit, markup and gross margin.
 * Markup % = (profit / cost) * 100
 * Margin % = (profit / sellingPrice) * 100
 */
function calculatePricing(cost, markupPercent = 50) {
  const c = Math.max(0, Number(cost) || 0);
  const markup = Math.max(0, Number(markupPercent) || 0);

  const suggestedSellingPrice = c * (1 + markup / 100);
  const profit = suggestedSellingPrice - c;
  const marginPercent = suggestedSellingPrice > 0 ? (profit / suggestedSellingPrice) * 100 : 0;

  return {
    cost: c,
    markupPercent: markup,
    suggestedSellingPrice,
    profit,
    marginPercent,
  };
}

/**
 * Given target margin %, calculates selling price:
 * Selling Price = Cost / (1 - targetMargin / 100)
 */
function calculatePriceFromMargin(cost, targetMarginPercent = 33.333333) {
  const c = Math.max(0, Number(cost) || 0);
  const margin = Math.min(99.99, Math.max(0, Number(targetMarginPercent) || 0));

  const marginDecimal = margin / 100;
  const sellingPrice = marginDecimal < 1 ? c / (1 - marginDecimal) : c;
  const profit = sellingPrice - c;
  const markupPercent = c > 0 ? (profit / c) * 100 : 0;

  return {
    cost: c,
    marginPercent: margin,
    suggestedSellingPrice: sellingPrice,
    profit,
    markupPercent,
  };
}

/**
 * Evaluates full recipe cost breakdown.
 * Components can be materials or nested sub-recipes.
 */
function evaluateRecipeCost(recipe, materialMap = new Map(), subRecipeMap = new Map()) {
  let ingredientCost = 0;
  let packagingCost = 0;
  let labourCost = 0;
  let resourceCost = 0;

  const components = (recipe.components || []).map((comp) => {
    let unitCost = 0;
    let totalCost = 0;
    let resolvedUom = comp.uom;
    const qty = Number(comp.quantity) || 0;

    if (comp.componentType === 'sub_recipe' && comp.subRecipeId) {
      const sub = subRecipeMap.get(String(comp.subRecipeId));
      if (sub) {
        // Sub-recipe unit cost (per gram or per yield unit)
        const subCostPerUnit = sub.costPerUnit || (sub.yieldQuantity > 0 ? sub.totalBatchCost / sub.yieldQuantity : 0);
        unitCost = subCostPerUnit;
        totalCost = qty * unitCost;
        ingredientCost += totalCost;
      }
    } else if (comp.materialId) {
      const mat = materialMap.get(String(comp.materialId));
      if (mat) {
        const baseCost = Number(mat.effectiveUnitCost) || 0;
        const baseUom = mat.baseUom || 'g';
        resolvedUom = baseUom;

        if (comp.scalingMethod === 'stepped') {
          // E.g., Oven: capacity 4 cakes, 1 cake = 1 cycle, 5 cakes = 2 cycles
          const capacity = Number(comp.capacityPerCycle) || 1;
          const cycles = Math.ceil(1 / capacity);
          const minutes = Number(comp.cycleMinutes) || 60;
          // rate per minute
          const rate = convertUnits(baseCost, baseUom, 'minute');
          unitCost = rate;
          totalCost = cycles * minutes * rate;
          resourceCost += totalCost;
        } else {
          // Standard linear or fixed usage
          const qtyInBaseUom = convertUnits(qty, comp.uom, baseUom, mat.densityGramPerMl || 1);
          unitCost = baseCost;
          totalCost = qtyInBaseUom * baseCost;

          const type = mat.type || comp.itemType || 'ingredient';
          if (type === 'packaging') packagingCost += totalCost;
          else if (type === 'labour') labourCost += totalCost;
          else if (type === 'resource') resourceCost += totalCost;
          else ingredientCost += totalCost;
        }
      }
    }

    return {
      ...comp.toObject ? comp.toObject() : comp,
      unitCost,
      totalCost,
    };
  });

  const totalBatchCost = ingredientCost + packagingCost + labourCost + resourceCost;
  const yieldUnits = Number(recipe.yieldQuantity) > 0 ? Number(recipe.yieldQuantity) : 1;
  const costPerUnit = totalBatchCost / yieldUnits;

  const pricing = calculatePricing(costPerUnit, recipe.targetMarkupPercent || 50);

  return {
    ingredientCost,
    packagingCost,
    labourCost,
    resourceCost,
    totalBatchCost,
    costPerUnit,
    suggestedSellingPrice: pricing.suggestedSellingPrice,
    components,
  };
}

/**
 * Scale a recipe for a target quantity (e.g. 7 cakes from 1 base cake)
 */
function scaleRecipeForQuantity(recipe, targetUnits, materialMap = new Map(), subRecipeMap = new Map()) {
  const target = Math.max(0.001, Number(targetUnits) || 1);
  const baseUnits = Number(recipe.baseBatchUnits) > 0
    ? Number(recipe.baseBatchUnits)
    : (Number(recipe.yieldQuantity) > 0 ? Number(recipe.yieldQuantity) : 1);
  const factor = target / baseUnits;

  let ingredientCost = 0;
  let packagingCost = 0;
  let labourCost = 0;
  let resourceCost = 0;
  let rawComponents = recipe.components || [];
  if (rawComponents.length === 0 && Array.isArray(recipe.materials)) {
    rawComponents = recipe.materials.map((m) => ({
      materialId: m.materialId || m.material,
      quantity: m.quantity,
      uom: m.uom || 'g',
      name: m.name,
      scalingMethod: m.scalingMethod || 'linear',
      itemType: m.itemType || 'ingredient',
    }));
  }

  const scaledComponents = rawComponents.map((comp) => {
    let scaledQty = 0;
    let unitCost = 0;
    let totalCost = 0;

    if (comp.scalingMethod === 'stepped') {
      // E.g. Oven capacity 4 cakes: 7 cakes = ceil(7/4) = 2 cycles
      const capacity = Number(comp.capacityPerCycle) || 1;
      const cycles = Math.ceil(target / capacity);
      const minutes = (Number(comp.cycleMinutes) || 60) * cycles;
      scaledQty = minutes;

      const mat = comp.materialId ? materialMap.get(String(comp.materialId)) : null;
      const rate = mat ? convertUnits(Number(mat.effectiveUnitCost) || 0, mat.baseUom, 'minute') : (Number(comp.unitCost) || 0);
      unitCost = rate;
      totalCost = minutes * rate;
      resourceCost += totalCost;

      return {
        name: comp.name || (mat ? mat.name : 'Oven / Equipment'),
        category: 'Resource',
        itemType: 'resource',
        scalingMethod: 'stepped',
        cycles,
        quantity: minutes,
        uom: 'minute',
        unitCost,
        totalCost,
      };
    }

    if (comp.scalingMethod === 'fixed') {
      scaledQty = Number(comp.quantity) || 0;
    } else {
      // Linear
      scaledQty = (Number(comp.quantity) || 0) * factor;
    }

    if (comp.componentType === 'sub_recipe' && comp.subRecipeId) {
      const sub = subRecipeMap.get(String(comp.subRecipeId));
      const subRate = sub ? (sub.costPerUnit || (sub.totalBatchCost / (sub.yieldQuantity || 1))) : 0;
      unitCost = subRate;
      totalCost = scaledQty * unitCost;
      ingredientCost += totalCost;

      return {
        subRecipeId: comp.subRecipeId,
        name: comp.name || (sub ? sub.name : 'Sub-Recipe'),
        category: 'Sub-Recipe',
        itemType: 'sub_recipe',
        scalingMethod: comp.scalingMethod || 'linear',
        quantity: scaledQty,
        uom: comp.uom,
        unitCost,
        totalCost,
      };
    }

    const mat = comp.materialId ? materialMap.get(String(comp.materialId)) : null;
    if (mat) {
      const baseCost = Number(mat.effectiveUnitCost) || 0;
      const baseUom = mat.baseUom || 'g';
      const qtyInBase = convertUnits(scaledQty, comp.uom, baseUom, mat.densityGramPerMl || 1);
      unitCost = baseCost;
      totalCost = qtyInBase * baseCost;

      const type = mat.type || comp.itemType || 'ingredient';
      if (type === 'packaging') packagingCost += totalCost;
      else if (type === 'labour') labourCost += totalCost;
      else if (type === 'resource') resourceCost += totalCost;
      else ingredientCost += totalCost;
    }

    return {
      materialId: comp.materialId,
      name: comp.name || (mat ? mat.name : 'Item'),
      category: mat ? mat.category : 'General',
      itemType: mat ? mat.type : (comp.itemType || 'ingredient'),
      scalingMethod: comp.scalingMethod || 'linear',
      quantity: scaledQty,
      uom: comp.uom,
      unitCost,
      totalCost,
    };
  });

  if (recipe.labourMinutes && !rawComponents.some((c) => c.itemType === 'labour')) {
    const hourlyRate = Number(recipe.labourHourlyRate) || 120;
    const lMins = (Number(recipe.labourMinutes) || 0) * factor;
    const lTotal = (lMins / 60) * hourlyRate;
    labourCost += lTotal;
  }
  if (recipe.ovenCycleCost && !rawComponents.some((c) => c.itemType === 'resource')) {
    const cycleRate = Number(recipe.ovenCycleCost) || 30;
    const cycles = Number(recipe.ovenCycles || 1) * Math.ceil(factor);
    resourceCost += cycles * cycleRate;
  }

  const totalCost = ingredientCost + packagingCost + labourCost + resourceCost;
  const costPerUnit = totalCost / target;
  const pricing = calculatePricing(totalCost, recipe.targetMarkupPercent || 50);

  return {
    targetUnits,
    recipeName: recipe.name,
    yieldUom: recipe.yieldUom || 'unit',
    ingredientCost,
    packagingCost,
    labourCost,
    resourceCost,
    totalCost,
    costPerUnit,
    suggestedSellingPrice: pricing.suggestedSellingPrice,
    profit: pricing.profit,
    marginPercent: pricing.marginPercent,
    components: scaledComponents,
  };
}

/**
 * Aggregates grocery requirements from multiple recipes & quantities.
 * Example: 8 Brownies + 4 Butter Cakes + 60 Cookies -> Total Flour, Butter, etc.
 */
function aggregateMultiProductRequirements(plans, materialMap = new Map(), subRecipeMap = new Map()) {
  const ingredientTotals = new Map();
  const packagingTotals = new Map();
  const labourTotals = new Map();
  const resourceTotals = new Map();

  let grandIngredientCost = 0;
  let grandPackagingCost = 0;
  let grandLabourCost = 0;
  let grandResourceCost = 0;

  for (const item of plans) {
    const recipe = item.recipe;
    const qty = Number(item.quantity) || 1;
    const scaled = scaleRecipeForQuantity(recipe, qty, materialMap, subRecipeMap);

    grandIngredientCost += scaled.ingredientCost;
    grandPackagingCost += scaled.packagingCost;
    grandLabourCost += scaled.labourCost;
    grandResourceCost += scaled.resourceCost;

    for (const comp of scaled.components) {
      const key = comp.materialId ? String(comp.materialId) : comp.name;
      const type = comp.itemType;

      let targetMap;
      if (type === 'packaging') targetMap = packagingTotals;
      else if (type === 'labour') targetMap = labourTotals;
      else if (type === 'resource') targetMap = resourceTotals;
      else targetMap = ingredientTotals;

      if (targetMap.has(key)) {
        const existing = targetMap.get(key);
        existing.quantity += comp.quantity;
        existing.totalCost += comp.totalCost;
      } else {
        targetMap.set(key, {
          materialId: comp.materialId || null,
          name: comp.name,
          category: comp.category,
          quantity: comp.quantity,
          uom: comp.uom,
          unitCost: comp.unitCost,
          totalCost: comp.totalCost,
        });
      }
    }
  }

  // Calculate stock shortages against on-hand inventory
  const ingredientsWithStock = Array.from(ingredientTotals.values()).map((ing) => {
    const mat = ing.materialId ? materialMap.get(String(ing.materialId)) : null;
    const currentStock = mat ? Number(mat.currentStock) || 0 : 0;
    const baseUom = mat ? mat.baseUom : ing.uom;
    const reqInBase = convertUnits(ing.quantity, ing.uom, baseUom, mat?.densityGramPerMl || 1);
    const shortage = Math.max(0, reqInBase - currentStock);

    const packQty = mat ? Number(mat.packQuantity) || 1 : 1;
    const packUom = mat ? mat.packUom : baseUom;
    const packInBase = convertUnits(packQty, packUom, baseUom);
    const packsNeeded = shortage > 0 ? Math.ceil(shortage / (packInBase || 1)) : 0;
    const estimatedSpend = packsNeeded * (mat ? Number(mat.purchasePrice) || 0 : 0);

    return {
      ...ing,
      currentStock,
      shortage,
      packsNeeded,
      packFormat: mat ? `${mat.packQuantity} ${mat.packUom}` : 'Pack',
      supplierName: mat ? mat.supplierName : '',
      estimatedSpend,
    };
  });

  const totalCost = grandIngredientCost + grandPackagingCost + grandLabourCost + grandResourceCost;

  return {
    ingredients: ingredientsWithStock,
    packaging: Array.from(packagingTotals.values()),
    labour: Array.from(labourTotals.values()),
    resources: Array.from(resourceTotals.values()),
    totalCost,
    ingredientCost: grandIngredientCost,
    packagingCost: grandPackagingCost,
    labourCost: grandLabourCost,
    resourceCost: grandResourceCost,
  };
}

module.exports = {
  convertUnits,
  calculateEffectiveUnitCost,
  calculatePricing,
  calculatePriceFromMargin,
  evaluateRecipeCost,
  scaleRecipeForQuantity,
  aggregateMultiProductRequirements,
};
