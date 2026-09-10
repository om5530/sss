const Decimal = require("decimal.js").clone({ precision: 40, rounding: 4 });
const ApiError = require("../utils/ApiError");

// Authoritative arithmetic uses Decimal; persisted/API amounts are decimal strings.
function dec(value, label = "Quantity", positive = false) {
  let d;
  try {
    d = new Decimal(value?.toString());
  } catch {
    throw ApiError.badRequest(`${label} must be a number`);
  }
  if (!d.isFinite() || d.isNegative() || (positive && d.isZero()))
    throw ApiError.badRequest(
      `${label} must be ${positive ? "greater than zero" : "non-negative"}`,
    );
  return d;
}
const units = {
  mg: ["mass", ".001"],
  g: ["mass", 1],
  kg: ["mass", 1000],
  ml: ["volume", 1],
  l: ["volume", 1000],
  piece: ["count", 1],
  dozen: ["count", 12],
  box: ["box", 1],
  packet: ["packet", 1],
  minute: ["time", 1],
  hour: ["time", 60],
};
const aliases = {
  gm: "g",
  gram: "g",
  kilogram: "kg",
  litre: "l",
  liter: "l",
  ltr: "l",
  millilitre: "ml",
  pcs: "piece",
  pc: "piece",
  min: "minute",
  cake: "piece",
  unit: "piece",
  cookie: "piece",
};
function unit(u) {
  const v = String(u).toLowerCase();
  return aliases[v] || v;
}
function convertUnits(quantity, from, to, density) {
  const q = dec(quantity),
    f = unit(from),
    t = unit(to);
  if (!units[f] || !units[t])
    throw ApiError.badRequest(`Unsupported unit: ${from} → ${to}`);
  const [fd, ff] = units[f],
    [td, tf] = units[t];
  let base = q.mul(ff);
  if (fd !== td) {
    if (
      !["mass", "volume"].includes(fd) ||
      !["mass", "volume"].includes(td) ||
      density == null
    )
      throw ApiError.badRequest(
        `Cannot convert ${from} to ${to} without a material-specific conversion`,
      );
    const d = dec(density, "Density", true);
    base = fd === "mass" ? base.div(d) : base.mul(d);
  }
  return base.div(tf).toString();
}
function calculateEffectiveUnitCost(
  packQuantity,
  packUom,
  price,
  baseUom,
  density,
) {
  dec(packQuantity, "Pack quantity", true);
  return dec(price, "Purchase price")
    .div(convertUnits(packQuantity, packUom, baseUom, density))
    .toString();
}
function priceResult(c, selling, markup) {
  const profit = selling.sub(c);
  return {
    cost: c.toString(),
    markupPercent: (
      markup ?? (c.isZero() ? new Decimal(0) : profit.div(c).mul(100))
    ).toString(),
    suggestedSellingPrice: selling.toString(),
    profit: profit.toString(),
    marginPercent: (selling.isZero()
      ? new Decimal(0)
      : profit.div(selling).mul(100)
    ).toString(),
  };
}
function calculatePricing(cost, markup = 50) {
  const c = dec(cost, "Cost"),
    m = dec(markup, "Markup");
  return priceResult(c, c.mul(m.div(100).add(1)), m);
}
function calculatePriceFromMargin(cost, margin) {
  const c = dec(cost, "Cost"),
    m = dec(margin, "Margin");
  if (m.gte(100))
    throw ApiError.badRequest("Target margin must be less than 100%");
  return priceResult(c, c.div(new Decimal(1).sub(m.div(100))));
}
function rate(m) {
  if (m.packQuantity != null && m.purchasePrice != null)
    return calculateEffectiveUnitCost(
      m.packQuantity,
      m.packUom,
      m.purchasePrice,
      m.baseUom,
      m.densityGramPerMl,
    );
  return dec(m.effectiveUnitCost, "Material rate").toString();
}
function targetCount(recipe, qty, uom) {
  const q = dec(qty, "Requested quantity", true);
  if (!uom || unit(uom) === unit(recipe.yieldUom || "piece")) return q;
  if (
    ["g", "kg", "mg"].includes(unit(uom)) &&
    !["g", "kg", "mg"].includes(unit(recipe.yieldUom))
  )
    return new Decimal(convertUnits(q, uom, "g"))
      .div(dec(recipe.finishedWeightGrams, "Finished batch weight", true))
      .mul(
        dec(recipe.yieldQuantity ?? recipe.baseBatchUnits ?? 1, "Yield", true),
      );
  return new Decimal(convertUnits(q, uom, recipe.yieldUom));
}
const costKeys = [
  "ingredientCost",
  "packagingCost",
  "labourCost",
  "resourceCost",
  "otherCost",
  "overheadCost",
];
function scaleRecipeForQuantity(
  recipe,
  targetUnits,
  materials = new Map(),
  recipes = new Map(),
  options = {},
) {
  const path = options.path || [],
    id = String(recipe._id || recipe.code || recipe.name);
  if (path.includes(id) || path.length >= 32)
    throw ApiError.badRequest(
      "Circular or excessively deep sub-recipe reference",
    );
  const target = targetCount(recipe, targetUnits, options.uom),
    base = dec(
      recipe.yieldQuantity ?? recipe.baseBatchUnits ?? 1,
      "Recipe yield",
      true,
    ),
    factor = target.div(base);
  const extra = [];
  for (const name of options.options || []) {
    const choice = (recipe.options || []).find((o) => o.name === name);
    if (!choice) throw ApiError.badRequest(`Unknown recipe option: ${name}`);
    extra.push(...choice.components);
  }
  const components = [],
    requirements = [],
    versions = [
      { recipeId: recipe._id, name: recipe.name, version: recipe.version ?? 1 },
    ];
  const totals = Object.fromEntries(costKeys.map((k) => [k, new Decimal(0)]));
  for (const raw of [...(recipe.components || []), ...extra]) {
    const comp = raw.toObject ? raw.toObject() : raw;
    let quantity = dec(comp.quantity ?? 0),
      cost,
      unitCost,
      uom = comp.uom,
      type,
      name = comp.name,
      materialId = comp.materialId;
    quantity = quantity
      .mul(comp.scalingMethod === "fixed" ? factor.ceil() : factor)
      .mul(dec(comp.workers ?? 1, "Workers", true));
    if (comp.componentType === "sub_recipe") {
      const sub = recipes.get(String(comp.subRecipeId));
      if (!sub || sub.isActive === false)
        throw ApiError.badRequest(
          `Sub-recipe unavailable: ${name || comp.subRecipeId}`,
        );
      const result = scaleRecipeForQuantity(sub, quantity, materials, recipes, {
        uom,
        path: [...path, id],
      });
      cost = new Decimal(result.totalCost);
      unitCost = quantity.isZero() ? "0" : cost.div(quantity).toString();
      for (const k of costKeys) totals[k] = totals[k].add(result[k]);
      requirements.push(...result.requirements);
      versions.push(...result.versions);
      type = "sub_recipe";
      name = sub.name;
    } else if (comp.componentType === "other") {
      unitCost = dec(comp.unitCost ?? 0, "Direct cost").toString();
      cost = quantity.mul(unitCost);
      type = "other";
      totals.otherCost = totals.otherCost.add(cost);
    } else {
      const mat = materials.get(String(materialId));
      if (!mat || mat.isActive === false)
        throw ApiError.badRequest(
          `Material unavailable: ${name || materialId}`,
        );
      name = mat.name;
      type = mat.type || "ingredient";
      unitCost = rate(mat);
      uom = mat.baseUom;
      if (comp.scalingMethod === "stepped") {
        if (type !== "resource")
          throw ApiError.badRequest("Capacity scaling requires a resource");
        const cycles = target
          .div(dec(comp.capacityPerCycle, "Capacity", true))
          .ceil();
        quantity = new Decimal(
          convertUnits(
            cycles.mul(dec(comp.cycleMinutes, "Cycle duration", true)),
            "minute",
            mat.baseUom,
          ),
        );
      } else
        quantity = new Decimal(
          convertUnits(quantity, comp.uom, mat.baseUom, mat.densityGramPerMl),
        );
      cost = quantity.mul(unitCost);
      const k = {
        ingredient: "ingredientCost",
        packaging: "packagingCost",
        labour: "labourCost",
        resource: "resourceCost",
      }[type];
      if (!k) throw ApiError.badRequest("Invalid material type");
      totals[k] = totals[k].add(cost);
      requirements.push({
        materialId: String(materialId),
        name,
        itemType: type,
        category: mat.category,
        quantity: quantity.toString(),
        uom,
        unitCost,
        totalCost: cost.toString(),
        packQuantity: mat.packQuantity,
        packUom: mat.packUom,
        purchasePrice: mat.purchasePrice,
        supplierName: mat.supplierName,
      });
    }
    components.push({
      ...comp,
      name,
      itemType: type,
      materialId,
      quantity: quantity.toString(),
      uom,
      unitCost,
      totalCost: cost.toString(),
    });
  }
  totals.overheadCost = dec(recipe.overheadPerBatch ?? 0, "Overhead").mul(
    factor,
  );
  const total = Object.values(totals).reduce(
    (a, b) => a.add(b),
    new Decimal(0),
  );
  const pricing =
    options.targetMargin != null
      ? calculatePriceFromMargin(total, options.targetMargin)
      : calculatePricing(
          total,
          options.targetMarkup ?? recipe.targetMarkupPercent ?? 50,
        );
  const finishedWeightGrams = dec(recipe.finishedWeightGrams ?? 0).mul(factor);
  return {
    ...Object.fromEntries(costKeys.map((k) => [k, totals[k].toString()])),
    ...pricing,
    totalCost: total.toString(),
    costPerUnit: total.div(target).toString(),
    costPerGram: finishedWeightGrams.gt(0)
      ? total.div(finishedWeightGrams).toString()
      : null,
    finishedWeightGrams: finishedWeightGrams.toString(),
    expectedLossPercent: dec(recipe.expectedLossPercent ?? 0).toString(),
    targetUnits: target.toString(),
    recipeName: recipe.name,
    yieldUom: recipe.yieldUom || "piece",
    components,
    requirements,
    versions,
  };
}
function evaluateRecipeCost(recipe, materials, recipes) {
  const r = scaleRecipeForQuantity(
    recipe,
    recipe.yieldQuantity ?? recipe.baseBatchUnits ?? 1,
    materials,
    recipes,
  );
  return {
    ...r,
    totalBatchCost: r.totalCost,
    suggestedSellingPrice: calculatePricing(
      r.costPerUnit,
      recipe.targetMarkupPercent ?? 50,
    ).suggestedSellingPrice,
  };
}
function aggregateMultiProductRequirements(
  plans,
  materials,
  recipes = new Map(),
) {
  const groups = new Map(),
    products = [],
    versions = [],
    totals = Object.fromEntries(costKeys.map((k) => [k, new Decimal(0)]));
  for (const plan of plans) {
    const r = scaleRecipeForQuantity(
      plan.recipe,
      plan.quantity,
      materials,
      recipes,
      { uom: plan.uom, options: plan.options },
    );
    products.push({
      recipeId: String(plan.recipe._id),
      recipeName: plan.recipe.name,
      version: plan.recipe.version,
      quantity: r.targetUnits,
      ...r,
    });
    versions.push(...r.versions);
    for (const k of costKeys) totals[k] = totals[k].add(r[k]);
    for (const c of r.requirements) {
      const old = groups.get(c.materialId);
      if (old) {
        old.quantity = new Decimal(old.quantity).add(c.quantity).toString();
        old.totalCost = new Decimal(old.totalCost).add(c.totalCost).toString();
      } else groups.set(c.materialId, { ...c });
    }
  }
  const requirements = [...groups.values()].map((c) => {
    const m = materials.get(c.materialId),
      stock = dec(m.currentStock ?? 0),
      allocated = dec(m.allocatedStock ?? 0),
      available = Decimal.max(0, stock.sub(allocated)),
      shortage = Decimal.max(0, dec(c.quantity).sub(available));
    const pack = dec(
      convertUnits(
        m.packQuantity ?? 1,
        m.packUom ?? m.baseUom,
        m.baseUom,
        m.densityGramPerMl,
      ),
      "Pack quantity",
      true,
    );
    const packs = shortage.isZero()
      ? new Decimal(0)
      : Decimal.max(shortage.div(pack).ceil(), dec(m.minimumOrderPacks ?? 1));
    return {
      ...c,
      currentStock: stock.toString(),
      allocated: allocated.toString(),
      available: available.toString(),
      shortage: shortage.toString(),
      packsNeeded: packs.toString(),
      estimatedSpend: packs.mul(m.purchasePrice ?? 0).toString(),
      packFormat: `${m.packQuantity} ${m.packUom}`,
      supplierName: m.supplierName || "",
    };
  });
  return {
    ...Object.fromEntries(costKeys.map((k) => [k, totals[k].toString()])),
    totalCost: Object.values(totals)
      .reduce((a, b) => a.add(b), new Decimal(0))
      .toString(),
    ingredients: requirements.filter((r) => r.itemType === "ingredient"),
    packaging: requirements.filter((r) => r.itemType === "packaging"),
    labour: requirements.filter((r) => r.itemType === "labour"),
    resources: requirements.filter((r) => r.itemType === "resource"),
    requirements,
    products,
    versions,
  };
}
module.exports = {
  Decimal,
  dec,
  unit,
  rate,
  convertUnits,
  calculateEffectiveUnitCost,
  calculatePricing,
  calculatePriceFromMargin,
  evaluateRecipeCost,
  scaleRecipeForQuantity,
  aggregateMultiProductRequirements,
};
