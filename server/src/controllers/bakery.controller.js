const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const Material = require("../models/BakeryMaterial");
const Recipe = require("../models/BakeryRecipe");
const Waste = require("../models/BakeryWaste");
const O = require("../models/BakeryOperations");
const E = require("../services/bakeryCost.service");
const ApiError = require("../utils/ApiError");
const { Decimal: D, dec } = E;
const pick = (data, fields) =>
  Object.fromEntries(
    fields.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
  );
const date = (value) => {
  const d = new Date(value || Date.now());
  if (!Number.isFinite(d.getTime())) throw ApiError.badRequest("Invalid date");
  return d;
};
const id = (value) => {
  if (!mongoose.isValidObjectId(value))
    throw ApiError.badRequest("Invalid record ID");
  return String(value);
};
const key = (req) => {
  const k = req.body.operationKey;
  if (typeof k !== "string" || k.length < 8 || k.length > 100)
    throw ApiError.badRequest("An operation key is required");
  return k;
};
const handler = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, ...(await fn(req)) });
  } catch (e) {
    next(e);
  }
};
const read = (model, query = {}, session) =>
  model
    .find(query)
    .session(session || null)
    .lean();
async function get(model, value, session) {
  const r = await model.findById(id(value)).session(session || null);
  if (!r) throw ApiError.notFound("Record not found");
  return r;
}

// A shared write guard serializes bakery mutations, including recipe graph and stock checks.
// Mongo transactions make movements, receipt/production state and balances atomic together.
async function transaction(fn) {
  try {
    await O.Migration.updateOne(
      { key: "write-guard" },
      { $setOnInsert: { notes: "" } },
      { upsert: true },
    );
  } catch (e) {
    if (e.code !== 11000) throw e;
  }
  return mongoose.connection.transaction(async (session) => {
    await O.Migration.updateOne(
      { key: "write-guard" },
      { $set: { notes: randomUUID() } },
      { session },
    );
    return fn(session);
  });
}
async function maps(session, at = new Date(), excludePlanId) {
  const materials = new Map(
    (await read(Material, {}, session)).map((m) => [String(m._id), m]),
  );
  const prices = await O.Price.find({ effectiveAt: { $lte: at } })
    .sort({ effectiveAt: -1, _id: -1 })
    .session(session || null)
    .lean();
  const latest = new Map();
  for (const p of prices)
    if (!latest.has(String(p.formatId))) latest.set(String(p.formatId), p);
  const formats = new Map(
    (await read(O.Format, {}, session)).map((f) => [String(f._id), f]),
  );
  const suppliers = new Map(
    (await read(O.Supplier, {}, session)).map((s) => [String(s._id), s]),
  );
  for (const m of materials.values()) {
    const f = formats.get(String(m.preferredFormatId)),
      p = f && latest.get(String(f._id));
    if (f && p)
      Object.assign(m, {
        packQuantity: p.packQuantity,
        packUom: p.packUom,
        purchasePrice: p.purchasePrice,
        effectiveUnitCost: E.calculateEffectiveUnitCost(
          p.packQuantity,
          p.packUom,
          p.purchasePrice,
          m.baseUom,
          m.densityGramPerMl,
        ),
        minimumOrderPacks: f.minimumOrderPacks,
        supplierName: suppliers.get(String(f.supplierId))?.name || "",
      });
    m.allocatedStock = "0";
  }
  for (const plan of await read(
    O.Sheet,
    {
      status: "scheduled",
      type: "production_plan",
      ...(excludePlanId ? { _id: { $ne: id(excludePlanId) } } : {}),
    },
    session,
  ))
    for (const r of plan.snapshot?.requirements || []) {
      const m = materials.get(String(r.materialId));
      if (m && ["ingredient", "packaging"].includes(m.type))
        m.allocatedStock = new D(m.allocatedStock).add(r.quantity).toString();
    }
  return {
    materials,
    recipes: new Map(
      (await read(Recipe, {}, session)).map((r) => [String(r._id), r]),
    ),
    latest,
    formats,
    suppliers,
  };
}
async function simulate(body, session) {
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 100
  )
    throw ApiError.badRequest("Choose between 1 and 100 recipes");
  const m = await maps(session, new Date(), body.excludePlanId);
  const plans = body.items.map((item) => {
    const recipe = m.recipes.get(id(item.recipeId));
    if (!recipe || !recipe.isActive)
      throw ApiError.badRequest("Recipe is unavailable");
    return {
      recipe,
      quantity: item.quantity,
      uom: item.uom,
      options: item.options,
    };
  });
  const result = E.aggregateMultiProductRequirements(
    plans,
    m.materials,
    m.recipes,
  );
  result.products = result.products.map((p, index) => ({
    ...p,
    lineId: String(index),
  }));
  return {
    ...result,
    ...(body.targetMargin != null
      ? E.calculatePriceFromMargin(result.totalCost, body.targetMargin)
      : E.calculatePricing(
          result.totalCost,
          body.targetMarkup ?? body.markupPercent ?? 50,
        )),
  };
}
async function move(
  materialId,
  delta,
  type,
  reference,
  notes,
  actorId,
  session,
) {
  const m = await get(Material, materialId, session),
    next = new D(m.currentStock).add(delta);
  if (next.isNegative())
    throw ApiError.conflict(`Insufficient stock: ${m.name}`);
  m.currentStock = next.toString();
  await m.save({ session });
  await O.Movement.create(
    [
      {
        materialId,
        quantity: String(delta),
        balance: next.toString(),
        type,
        reference,
        notes,
        actorId,
      },
    ],
    { session },
  );
  return m;
}
const materialFields = [
  "name",
  "code",
  "type",
  "category",
  "baseUom",
  "densityGramPerMl",
  "packQuantity",
  "packUom",
  "purchasePrice",
  "minimumStock",
  "reorderLevel",
  "supplierName",
  "brand",
  "leadTimeDays",
  "notes",
  "description",
  "image",
];
async function initialFormat(m, session) {
  let supplier = await O.Supplier.findOne({
    name: m.supplierName || "Direct purchase",
  }).session(session);
  if (!supplier)
    [supplier] = await O.Supplier.create(
      [{ name: m.supplierName || "Direct purchase" }],
      { session },
    );
  const [format] = await O.Format.create(
    [
      {
        materialId: m._id,
        supplierId: supplier._id,
        packQuantity: m.packQuantity,
        packUom: m.packUom,
        brand: m.brand,
        leadTimeDays: m.leadTimeDays,
      },
    ],
    { session },
  );
  await O.Price.create(
    [
      {
        formatId: format._id,
        materialId: m._id,
        supplierId: supplier._id,
        packQuantity: m.packQuantity,
        packUom: m.packUom,
        purchasePrice: m.purchasePrice,
        unitCost: E.rate(m),
        effectiveAt: new Date(),
      },
    ],
    { session },
  );
  m.preferredFormatId = format._id;
  await m.save({ session });
}
exports.getMaterials = handler(async (req) => {
  const m = await maps();
  let materials = [...m.materials.values()].filter((x) => x.isActive);
  if (req.query.type)
    materials = materials.filter((x) => x.type === req.query.type);
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase();
    materials = materials.filter((x) =>
      `${x.name} ${x.code}`.toLowerCase().includes(q),
    );
  }
  return { materials, count: materials.length };
});
exports.previewMaterial = handler(async (req) => ({
  unitCost: E.calculateEffectiveUnitCost(
    req.body.packQuantity,
    req.body.packUom,
    req.body.purchasePrice,
    req.body.baseUom,
    req.body.densityGramPerMl,
  ),
}));
exports.createMaterial = handler((req) =>
  transaction(async (session) => {
    const m = new Material({
      ...pick(req.body, materialFields),
      currentStock: "0",
    });
    m.effectiveUnitCost = E.rate(m);
    await m.save({ session });
    await initialFormat(m, session);
    if (dec(req.body.currentStock ?? 0).gt(0))
      await move(
        m._id,
        dec(req.body.currentStock).toString(),
        "opening",
        String(m._id),
        "Opening balance",
        req.user?._id,
        session,
      );
    return { material: await get(Material, m._id, session) };
  }),
);
exports.updateMaterial = handler((req) =>
  transaction(async (session) => {
    const m = await get(Material, req.params.id, session);
    if (req.body.baseUom && req.body.baseUom !== m.baseUom)
      throw ApiError.badRequest(
        "Base unit cannot change after creation; create a new material to preserve stock history",
      );
    const context = await maps(session),
      current = context.materials.get(String(m._id));
    const priceChanged = ["purchasePrice", "packQuantity", "packUom"].some(
      (k) => req.body[k] != null && String(req.body[k]) !== String(current[k]),
    );
    m.set(pick(req.body, materialFields));
    m.effectiveUnitCost = E.rate(m);
    await m.save({ session });
    if (priceChanged || !m.preferredFormatId) await initialFormat(m, session);
    return { material: m };
  }),
);
exports.deleteMaterial = handler((req) =>
  transaction(async (session) => {
    const refs = await Recipe.find({
      isActive: true,
      $or: [
        { "components.materialId": id(req.params.id) },
        { "options.components.materialId": id(req.params.id) },
      ],
    }).session(session);
    if (refs.length)
      throw ApiError.conflict("Material is used in active recipes");
    const m = await get(Material, req.params.id, session);
    m.isActive = false;
    await m.save({ session });
    return { material: m };
  }),
);
exports.getRecipes = handler(async () => {
  const m = await maps();
  const recipes = [...m.recipes.values()]
    .filter((r) => r.isActive)
    .map((r) => {
      try {
        return {
          ...r,
          ...E.evaluateRecipeCost(r, m.materials, m.recipes),
          components: r.components,
        };
      } catch (e) {
        return { ...r, costingError: e.message };
      }
    });
  return { recipes, count: recipes.length };
});
exports.getRecipeById = handler(async (req) => {
  const m = await maps(),
    r = m.recipes.get(id(req.params.id));
  if (!r) throw ApiError.notFound();
  return {
    recipe: {
      ...r,
      ...E.evaluateRecipeCost(r, m.materials, m.recipes),
      components: r.components,
    },
  };
});
const recipeFields = [
  "name",
  "code",
  "category",
  "isSubRecipe",
  "baseBatchUnits",
  "yieldQuantity",
  "yieldUom",
  "finishedWeightGrams",
  "components",
  "targetMarkupPercent",
  "manualSellingPrice",
  "instructions",
  "notes",
  "status",
  "productId",
  "overheadPerBatch",
  "expectedLossPercent",
  "options",
];
async function saveRecipe(req, session, creating) {
  const r = creating
    ? new Recipe(pick(req.body, recipeFields))
    : await get(Recipe, req.params.id, session);
  if (!creating) {
    if (Number(req.body.version) !== r.version)
      throw ApiError.conflict("Recipe changed. Reload before saving.");
    await O.Revision.updateOne(
      { recipeId: r._id, version: r.version },
      { $setOnInsert: { recipe: r.toObject() } },
      { upsert: true, session },
    );
    r.set(pick(req.body, recipeFields));
    r.version += 1;
  }
  if (dec(r.expectedLossPercent ?? 0).gte(100))
    throw ApiError.badRequest("Expected loss must be below 100%");
  if (!r.components.length || r.components.length > 200)
    throw ApiError.badRequest("Recipe needs between 1 and 200 components");
  const m = await maps(session);
  m.recipes.set(String(r._id), r.toObject());
  // Include option edges in graph validation, even when no option is currently selected.
  function graph(recipe, seen = []) {
    const rid = String(recipe._id);
    if (seen.includes(rid) || seen.length > 32)
      throw ApiError.badRequest("Circular sub-recipe reference");
    for (const c of [
      ...recipe.components,
      ...(recipe.options || []).flatMap((o) => o.components),
    ])
      if (c.componentType === "sub_recipe") {
        const sub = m.recipes.get(String(c.subRecipeId));
        if (!sub) throw ApiError.badRequest("Sub-recipe not found");
        graph(sub, [...seen, rid]);
      }
  }
  graph(r.toObject());
  const result = E.evaluateRecipeCost(r, m.materials, m.recipes);
  const names = (r.options || []).map((o) => o.name);
  if (names.some((n) => !n?.trim()) || new Set(names).size !== names.length)
    throw ApiError.badRequest("Custom options need distinct names");
  for (const name of names)
    E.scaleRecipeForQuantity(r, r.yieldQuantity, m.materials, m.recipes, {
      options: [name],
    });
  r.set(
    pick(result, [
      "ingredientCost",
      "packagingCost",
      "labourCost",
      "resourceCost",
      "totalBatchCost",
      "costPerUnit",
      "suggestedSellingPrice",
    ]),
  );
  await r.save({ session });
  await O.Revision.create(
    [{ recipeId: r._id, version: r.version, recipe: r.toObject() }],
    { session },
  );
  return { recipe: r };
}
exports.createRecipe = handler((req) =>
  transaction((s) => saveRecipe(req, s, true)),
);
exports.updateRecipe = handler((req) =>
  transaction((s) => saveRecipe(req, s, false)),
);
exports.deleteRecipe = handler((req) =>
  transaction(async (session) => {
    if (
      await Recipe.exists({
        isActive: true,
        $or: [
          { "components.subRecipeId": id(req.params.id) },
          { "options.components.subRecipeId": id(req.params.id) },
        ],
      }).session(session)
    )
      throw ApiError.conflict("Recipe is used by another recipe");
    const r = await get(Recipe, req.params.id, session);
    r.isActive = false;
    await r.save({ session });
    return { recipe: r };
  }),
);
exports.simulateRecipe = handler(async (req) => {
  const m = await maps(),
    r = m.recipes.get(id(req.body.recipeId));
  if (!r || !r.isActive) throw ApiError.notFound("Recipe unavailable");
  return {
    scaled: E.scaleRecipeForQuantity(
      r,
      req.body.quantity,
      m.materials,
      m.recipes,
      req.body,
    ),
  };
});
exports.simulateMultiProduct = handler(async (req) => ({
  aggregated: await simulate(req.body),
}));
exports.previewRecipe = handler(async (req) => {
  const m = await maps(),
    r = new Recipe(pick(req.body, recipeFields));
  if (req.body._id) r._id = id(req.body._id);
  await r.validate();
  m.recipes.set(String(r._id), r.toObject());
  return { result: E.evaluateRecipeCost(r, m.materials, m.recipes) };
});
exports.getCostingSheets = handler(async (req) => ({
  sheets: await read(O.Sheet, req.query.type ? { type: req.query.type } : {}),
}));
exports.saveCostingSheet = handler((req) =>
  transaction(async (session) => {
    const snapshot = await simulate(req.body, session);
    const [sheet] = await O.Sheet.create(
      [
        {
          ...pick(req.body, [
            "type",
            "referenceName",
            "customerName",
            "notes",
            "items",
          ]),
          requiredDate: req.body.requiredDate
            ? date(req.body.requiredDate)
            : null,
          code: `BK-${randomUUID().slice(0, 12)}`,
          snapshot,
          status: req.body.type === "production_plan" ? "scheduled" : "draft",
        },
      ],
      { session },
    );
    return { sheet };
  }),
);
exports.cancelSheet = handler((req) =>
  transaction(async (session) => {
    const s = await get(O.Sheet, req.params.id, session);
    if (s.status === "completed")
      throw ApiError.conflict("Completed batches cannot be cancelled");
    s.status = "cancelled";
    await s.save({ session });
    return { sheet: s };
  }),
);
exports.recalculateSheet = handler(async (req) => {
  const s = await get(O.Sheet, req.params.id);
  return {
    historical: s.snapshot,
    current: await simulate({
      items: s.items,
      targetMarkup: s.snapshot.markupPercent,
    }),
  };
});
exports.completeProduction = handler((req) =>
  transaction(async (session) => {
    const s = await get(O.Sheet, req.params.id, session),
      operationKey = key(req);
    if (s.status === "completed" && s.operationKey === operationKey)
      return { sheet: s };
    if (s.type !== "production_plan" || s.status !== "scheduled")
      throw ApiError.conflict("Only scheduled production can be completed");
    const overrides = req.body.ingredients || [],
      quantities = new Map(
        overrides.map((x) => [id(x.materialId), x.quantity]),
      );
    if (quantities.size !== overrides.length)
      throw ApiError.badRequest("Duplicate ingredient overrides");
    const expected = s.snapshot.requirements.filter((r) =>
      ["ingredient", "packaging"].includes(r.itemType),
    );
    if (
      overrides.some(
        (o) => !expected.some((r) => r.materialId === o.materialId),
      )
    )
      throw ApiError.badRequest("Unknown ingredient override");
    const consumption = [];
    let actualCost = new D(s.snapshot.totalCost);
    for (const r of expected) {
      const q = dec(quantities.get(r.materialId) ?? r.quantity),
        variance = q.sub(r.quantity);
      await move(
        r.materialId,
        q.neg().toString(),
        "consumption",
        s.code,
        req.body.notes,
        req.user?._id,
        session,
      );
      actualCost = actualCost.add(variance.mul(r.unitCost));
      consumption.push({
        ...r,
        plannedQuantity: r.quantity,
        quantity: q.toString(),
        variance: variance.toString(),
        totalCost: q.mul(r.unitCost).toString(),
      });
    }
    const submitted = req.body.outputs || [],
      matched = new Set();
    for (const o of submitted) {
      const candidates = s.snapshot.products.filter((p) =>
        o.lineId != null ? p.lineId === o.lineId : p.recipeId === o.recipeId,
      );
      if (candidates.length !== 1 || matched.has(candidates[0]))
        throw ApiError.badRequest(
          "Invalid or duplicate output; repeated recipes require a line ID",
        );
      matched.add(candidates[0]);
    }
    const outputs = s.snapshot.products.map((p) => {
      const actual = (req.body.outputs || []).find((o) =>
          o.lineId != null ? o.lineId === p.lineId : o.recipeId === p.recipeId,
        ),
        good = dec(actual?.quantity ?? p.targetUnits),
        waste = dec(actual?.waste ?? 0);
      const actualWeight =
        actual?.actualWeightGrams != null && actual.actualWeightGrams !== ""
          ? dec(actual.actualWeightGrams)
          : null;
      const inputWeight =
        actual?.inputWeightGrams != null && actual.inputWeightGrams !== ""
          ? dec(actual.inputWeightGrams, "Pre-bake weight", true)
          : null;
      if (inputWeight && actualWeight?.gt(inputWeight))
        throw ApiError.badRequest("Finished weight exceeds pre-bake weight");
      const expectedLoss = dec(p.expectedLossPercent ?? 0),
        expectedWeight = inputWeight
          ? inputWeight.mul(new D(1).sub(expectedLoss.div(100)))
          : dec(p.finishedWeightGrams ?? 0);
      const actualLoss =
        inputWeight && actualWeight
          ? inputWeight.sub(actualWeight).div(inputWeight).mul(100)
          : null;
      const share = dec(s.snapshot.totalCost).isZero()
        ? new D(0)
        : actualCost.mul(p.totalCost).div(s.snapshot.totalCost);
      return {
        lineId: p.lineId,
        recipeId: p.recipeId,
        recipeName: p.recipeName,
        version: p.version,
        planned: p.targetUnits,
        quantity: good.toString(),
        waste: waste.toString(),
        uom: p.yieldUom,
        variance: good.sub(p.targetUnits).toString(),
        unitCost: good.add(waste).isZero()
          ? p.costPerUnit
          : share.div(good.add(waste)).toString(),
        expectedLossPercent: expectedLoss.toString(),
        expectedWeightGrams: expectedWeight.toString(),
        inputWeightGrams: inputWeight?.toString(),
        actualWeightGrams: actualWeight?.toString(),
        actualLossPercent: actualLoss?.toString(),
        lossVariancePercent: actualLoss?.sub(expectedLoss).toString(),
        weightVarianceGrams: actualWeight?.sub(expectedWeight).toString(),
        allocatedCost: share.toString(),
      };
    });
    for (const o of outputs)
      if (dec(o.waste).gt(0))
        await Waste.create(
          [
            {
              productionId: s._id,
              materialName: o.recipeName,
              type: "production_scrap",
              quantity: o.waste,
              uom: o.uom,
              unitCost: o.unitCost,
              totalCostLost: dec(o.waste).mul(o.unitCost).toString(),
              reason: "Production Error",
            },
          ],
          { session },
        );
    for (const o of outputs)
      if (
        o.actualWeightGrams != null &&
        o.inputWeightGrams != null &&
        dec(o.inputWeightGrams).gt(o.actualWeightGrams)
      ) {
        const lost = dec(o.inputWeightGrams).sub(o.actualWeightGrams),
          unitCost = dec(o.allocatedCost).div(o.inputWeightGrams);
        await Waste.create(
          [
            {
              productionId: s._id,
              materialName: o.recipeName,
              type: "process_loss",
              quantity: lost.toString(),
              uom: "g",
              unitCost: unitCost.toString(),
              totalCostLost: lost.mul(unitCost).toString(),
              reason: "Other",
              notes:
                "Measured process/yield loss; not an additional stock deduction",
            },
          ],
          { session },
        );
      }
    s.actual = {
      consumption,
      outputs,
      totalCost: actualCost.toString(),
      notes: req.body.notes || "",
    };
    s.status = "completed";
    s.completedAt = new Date();
    s.operationKey = operationKey;
    await s.save({ session });
    return { sheet: s };
  }),
);
exports.getInventoryStatus = handler(async () => {
  const m = await maps(),
    materials = [...m.materials.values()]
      .filter((x) => x.isActive && ["ingredient", "packaging"].includes(x.type))
      .map((x) => ({
        ...x,
        available: D.max(
          0,
          dec(x.currentStock).sub(x.allocatedStock),
        ).toString(),
      })),
    lowStock = materials.filter((m) =>
      dec(m.available).lte(
        dec(m.reorderLevel || 0).gt(0) ? m.reorderLevel : m.minimumStock || 0,
      ),
    );
  return {
    materials,
    lowStock,
    lowStockCount: lowStock.length,
    movements: await O.Movement.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
  };
});
exports.updateStock = handler((req) =>
  transaction(async (session) => {
    const m = await get(Material, req.params.id, session);
    if (
      req.body.expectedStock != null &&
      !dec(req.body.expectedStock).eq(m.currentStock)
    )
      throw ApiError.conflict(
        "Stock changed. Reload before setting a new balance.",
      );
    let delta;
    if (req.body.packs != null) {
      const count = new D(req.body.packs);
      if (!count.isFinite() || !count.isInteger())
        throw ApiError.badRequest("Pack adjustment must be a whole number");
      const context = await maps(session),
        current = context.materials.get(String(m._id));
      delta = new D(
        E.convertUnits(
          count.abs().mul(current.packQuantity),
          current.packUom,
          m.baseUom,
          m.densityGramPerMl,
        ),
      ).mul(count.isNegative() ? -1 : 1);
    } else
      delta =
        req.body.currentStock != null
          ? dec(req.body.currentStock).sub(m.currentStock)
          : new D(req.body.adjustment);
    if (!delta.isFinite()) throw ApiError.badRequest("Invalid adjustment");
    return {
      material: await move(
        m._id,
        delta.toString(),
        req.body.type === "return" ? "return" : "adjustment",
        randomUUID(),
        req.body.notes || "Manual stock adjustment",
        req.user?._id,
        session,
      ),
    };
  }),
);
exports.getWasteLogs = handler(async () => {
  const logs = await Waste.find().sort({ date: -1 }).lean(),
    now = new Date(),
    localDay = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    start = new Date(localDay + "T00:00:00+05:30"),
    month = new Date(localDay.slice(0, 7) + "-01T00:00:00+05:30");
  const sum = (since) =>
    logs
      .filter((l) => l.date >= since && l.date <= now)
      .reduce((a, l) => a.add(l.totalCostLost), new D(0))
      .toString();
  return {
    logs,
    count: logs.length,
    todayCost: sum(start),
    monthCost: sum(month),
    weekCost: sum(new Date(start.getTime() - 6 * 86400000)),
  };
});
exports.logWaste = handler((req) =>
  transaction(async (session) => {
    const b = req.body,
      q = dec(b.quantity, "Waste quantity", true);
    let materialName, uom, unitCost, quantity;
    if (b.materialId) {
      const m = await get(Material, b.materialId, session),
        context = await maps(session),
        current = context.materials.get(String(m._id));
      quantity = E.convertUnits(
        q,
        b.uom || m.baseUom,
        m.baseUom,
        m.densityGramPerMl,
      );
      materialName = m.name;
      uom = m.baseUom;
      unitCost = E.rate(current);
      if (!["ingredient", "packaging"].includes(m.type))
        throw ApiError.badRequest(
          "Only ingredients or packaging can be discarded from stock",
        );
      const waste = new Waste({
        materialId: m._id,
        materialName,
        quantity,
        uom,
        unitCost,
        totalCostLost: dec(quantity).mul(unitCost).toString(),
        type: m.type === "packaging" ? "packaging" : "raw_material",
        reason: b.reason,
        notes: b.notes,
        date: date(b.date),
      });
      await waste.validate();
      await move(
        m._id,
        dec(quantity).neg().toString(),
        "waste",
        String(waste._id),
        b.reason,
        req.user?._id,
        session,
      );
      await waste.save({ session });
      return { waste };
    }
    const s = await get(O.Sheet, b.productionId, session);
    if (s.status !== "completed")
      throw ApiError.badRequest("Select a completed production batch");
    const candidates = s.actual.outputs.filter((o) =>
      b.lineId != null ? o.lineId === b.lineId : o.recipeId === b.recipeId,
    );
    if (candidates.length !== 1)
      throw ApiError.badRequest("Choose a specific product line in this batch");
    const output = candidates[0];
    const prior = await read(
      Waste,
      {
        productionId: s._id,
        materialName: output.recipeName,
        ...(output.lineId != null ? { outputLineId: output.lineId } : {}),
        type: "finished_good",
      },
      session,
    );
    const remaining = dec(output.quantity).sub(
      prior.reduce((a, w) => a.add(w.quantity), new D(0)),
    );
    quantity = E.convertUnits(q, b.uom || output.uom, output.uom);
    if (dec(quantity).gt(remaining))
      throw ApiError.conflict("Waste exceeds remaining batch output");
    const [waste] = await Waste.create(
      [
        {
          productionId: s._id,
          outputLineId: output.lineId,
          materialName: output.recipeName,
          quantity,
          uom: output.uom,
          unitCost: output.unitCost,
          totalCostLost: dec(quantity).mul(output.unitCost).toString(),
          type: "finished_good",
          reason: b.reason,
          notes: b.notes,
          date: date(b.date),
        },
      ],
      { session },
    );
    return { waste };
  }),
);

exports.getPurchasing = handler(async () => {
  const m = await maps();
  return {
    suppliers: [...m.suppliers.values()],
    formats: [...m.formats.values()].map((f) => ({
      ...f,
      price: m.latest.get(String(f._id)),
      supplierName: m.suppliers.get(String(f.supplierId))?.name,
      preferred:
        String(m.materials.get(String(f.materialId))?.preferredFormatId) ===
        String(f._id),
    })),
    prices: await O.Price.find().sort({ effectiveAt: -1 }).lean(),
    purchases: await O.Purchase.find().sort({ createdAt: -1 }).lean(),
    receipts: await O.Receipt.find().sort({ receivedAt: -1 }).lean(),
  };
});
exports.saveSupplier = handler((req) =>
  transaction(async (session) => {
    const [supplier] = await O.Supplier.create(
      [pick(req.body, ["name", "contact", "notes"])],
      { session },
    );
    return { supplier };
  }),
);
exports.saveFormat = handler((req) =>
  transaction(async (session) => {
    const b = req.body,
      m = await get(Material, b.materialId, session);
    await get(O.Supplier, b.supplierId, session);
    const unitCost = E.calculateEffectiveUnitCost(
      b.packQuantity,
      b.packUom,
      b.purchasePrice,
      m.baseUom,
      m.densityGramPerMl,
    );
    const [format] = await O.Format.create(
      [
        {
          ...pick(b, [
            "materialId",
            "supplierId",
            "supplierCode",
            "brand",
            "packUom",
          ]),
          packQuantity: dec(b.packQuantity, "Pack quantity", true).toString(),
          minimumOrderPacks: dec(
            b.minimumOrderPacks ?? 1,
            "Minimum packs",
            true,
          )
            .ceil()
            .toString(),
          leadTimeDays: dec(b.leadTimeDays ?? 0).toNumber(),
        },
      ],
      { session },
    );
    await O.Price.create(
      [
        {
          formatId: format._id,
          materialId: m._id,
          supplierId: format.supplierId,
          packQuantity: format.packQuantity,
          packUom: format.packUom,
          purchasePrice: dec(b.purchasePrice).toString(),
          unitCost,
          effectiveAt: date(b.effectiveAt),
        },
      ],
      { session },
    );
    if (b.preferred || !m.preferredFormatId) {
      m.preferredFormatId = format._id;
      await m.save({ session });
    }
    return { format };
  }),
);
exports.preferFormat = handler((req) =>
  transaction(async (session) => {
    const f = await get(O.Format, req.params.id, session),
      m = await get(Material, f.materialId, session);
    m.preferredFormatId = f._id;
    await m.save({ session });
    return { material: m };
  }),
);
exports.recordPrice = handler((req) =>
  transaction(async (session) => {
    const f = await get(O.Format, req.params.id, session),
      m = await get(Material, f.materialId, session),
      unitCost = E.calculateEffectiveUnitCost(
        f.packQuantity,
        f.packUom,
        req.body.purchasePrice,
        m.baseUom,
        m.densityGramPerMl,
      );
    const [price] = await O.Price.create(
      [
        {
          formatId: f._id,
          materialId: m._id,
          supplierId: f.supplierId,
          packQuantity: f.packQuantity,
          packUom: f.packUom,
          purchasePrice: dec(req.body.purchasePrice).toString(),
          unitCost,
          effectiveAt: date(req.body.effectiveAt),
        },
      ],
      { session },
    );
    return { price };
  }),
);
exports.purchaseRequirements = handler(async (req) => {
  const m = await maps(),
    result = await simulate(req.body);
  const requirements = [...result.ingredients, ...result.packaging].map(
    (r) => ({
      ...r,
      comparisons: [...m.formats.values()]
        .filter(
          (f) =>
            String(f.materialId) === r.materialId &&
            m.latest.has(String(f._id)),
        )
        .map((f) => {
          const p = m.latest.get(String(f._id)),
            material = m.materials.get(r.materialId),
            pack = dec(
              E.convertUnits(
                p.packQuantity,
                p.packUom,
                material.baseUom,
                material.densityGramPerMl,
              ),
            ),
            packs = dec(r.shortage).isZero()
              ? new D(0)
              : D.max(
                  dec(r.shortage).div(pack).ceil(),
                  dec(f.minimumOrderPacks),
                );
          return {
            formatId: f._id,
            supplierName: m.suppliers.get(String(f.supplierId))?.name,
            packs: packs.toString(),
            quantity: packs.mul(pack).toString(),
            excess: D.max(0, packs.mul(pack).sub(r.shortage)).toString(),
            spend: packs.mul(p.purchasePrice).toString(),
            unitCost: p.unitCost,
            leadTimeDays: f.leadTimeDays,
            preferred: String(material.preferredFormatId) === String(f._id),
          };
        }),
    }),
  );
  return { requirements };
});
exports.createPurchase = handler((req) =>
  transaction(async (session) => {
    const b = req.body;
    await get(O.Supplier, b.supplierId, session);
    if (!Array.isArray(b.lines) || !b.lines.length)
      throw ApiError.badRequest("Add purchase lines");
    const context = await maps(session),
      lines = [];
    for (const line of b.lines) {
      const f = await get(O.Format, line.formatId, session),
        price = context.latest.get(String(f._id)),
        packs = dec(line.packs, "Packs", true);
      if (
        !price ||
        String(f.supplierId) !== b.supplierId ||
        !packs.isInteger() ||
        packs.lt(f.minimumOrderPacks)
      )
        throw ApiError.badRequest(
          "Check supplier, price and minimum whole packs",
        );
      lines.push({
        lineId: randomUUID(),
        formatId: String(f._id),
        materialId: String(f.materialId),
        packQuantity: f.packQuantity,
        packUom: f.packUom,
        purchasePrice: price.purchasePrice,
        packs: packs.toString(),
        received: "0",
      });
    }
    const [purchase] = await O.Purchase.create(
      [
        {
          supplierId: b.supplierId,
          code: `PO-${randomUUID().slice(0, 12)}`,
          lines,
          notes: b.notes,
        },
      ],
      { session },
    );
    return { purchase };
  }),
);
exports.purchaseStatus = handler((req) =>
  transaction(async (session) => {
    const p = await get(O.Purchase, req.params.id, session),
      status = req.body.status;
    if (
      !(
        (p.status === "draft" && status === "ordered") ||
        (["draft", "ordered", "partially_received"].includes(p.status) &&
          status === "cancelled")
      )
    )
      throw ApiError.conflict("Invalid purchase status change");
    p.status = status;
    await p.save({ session });
    return { purchase: p };
  }),
);
exports.receivePurchase = handler((req) =>
  transaction(async (session) => {
    const operationKey = key(req),
      p = await get(O.Purchase, req.params.id, session),
      existing = await O.Receipt.findOne({ operationKey }).session(session);
    if (existing) {
      if (String(existing.purchaseId) !== String(p._id))
        throw ApiError.conflict("Operation key already used");
      return { receipt: existing, purchase: p };
    }
    if (!["ordered", "partially_received"].includes(p.status))
      throw ApiError.conflict("Purchase is not awaiting receipt");
    if (!Array.isArray(req.body.lines) || !req.body.lines.length)
      throw ApiError.badRequest("Select received lines");
    const received = [],
      seen = new Set();
    for (const item of req.body.lines) {
      const line = p.lines.find((l) => l.lineId === item.lineId);
      if (!line || seen.has(item.lineId))
        throw ApiError.badRequest("Invalid or duplicate receipt line");
      seen.add(item.lineId);
      const q = dec(item.packs, "Received packs", true);
      if (!q.isInteger() || q.add(line.received).gt(line.packs))
        throw ApiError.badRequest("Received packs exceed quantity ordered");
      const m = await get(Material, line.materialId, session),
        price = dec(item.purchasePrice ?? line.purchasePrice),
        quantity = E.convertUnits(
          q.mul(line.packQuantity),
          line.packUom,
          m.baseUom,
          m.densityGramPerMl,
        );
      await move(
        m._id,
        quantity,
        "receipt",
        p.code,
        item.lot || "",
        req.user?._id,
        session,
      );
      await O.Price.create(
        [
          {
            formatId: line.formatId,
            materialId: m._id,
            supplierId: p.supplierId,
            packQuantity: line.packQuantity,
            packUom: line.packUom,
            purchasePrice: price.toString(),
            unitCost: E.calculateEffectiveUnitCost(
              line.packQuantity,
              line.packUom,
              price,
              m.baseUom,
              m.densityGramPerMl,
            ),
            effectiveAt: date(req.body.receivedAt),
          },
        ],
        { session },
      );
      await O.Format.updateOne(
        { _id: line.formatId },
        { $set: { lastPurchasedAt: date(req.body.receivedAt) } },
        { session },
      );
      line.received = dec(line.received).add(q).toString();
      received.push({
        ...line,
        packs: q.toString(),
        purchasePrice: price.toString(),
        quantity,
        lot: item.lot,
        expiry: item.expiry ? date(item.expiry) : null,
      });
    }
    p.markModified("lines");
    p.status = p.lines.every((l) => dec(l.received).eq(l.packs))
      ? "received"
      : "partially_received";
    await p.save({ session });
    const [receipt] = await O.Receipt.create(
      [
        {
          purchaseId: p._id,
          operationKey,
          lines: received,
          receivedAt: date(req.body.receivedAt),
        },
      ],
      { session },
    );
    return { receipt, purchase: p };
  }),
);
exports.reports = handler(async (req) => {
  const m = await maps(),
    sheets = await read(O.Sheet),
    waste = await read(Waste),
    prices = await read(O.Price),
    movements = await read(O.Movement);
  const dayBoundary = (value, end) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? date(value + (end ? "T23:59:59.999+05:30" : "T00:00:00+05:30"))
      : date(value);
  const since = req.query.from
      ? dayBoundary(req.query.from, false)
      : new Date(0),
    until = req.query.to ? dayBoundary(req.query.to, true) : new Date();
  if (since > until)
    throw ApiError.badRequest("The start date must precede the end date");
  const batches = sheets.filter(
    (s) =>
      s.status === "completed" &&
      s.completedAt >= since &&
      s.completedAt <= until,
  );
  const recipes = [...m.recipes.values()]
    .filter((r) => r.isActive)
    .map((r) => {
      try {
        const c = E.evaluateRecipeCost(r, m.materials, m.recipes),
          old = dec(r.totalBatchCost ?? 0),
          diff = dec(c.totalBatchCost).sub(old);
        return {
          recipeId: r._id,
          name: r.name,
          ...c,
          oldCost: old.toString(),
          costChange: diff.toString(),
          costChangePercent: old.isZero()
            ? null
            : diff.div(old).mul(100).toString(),
          currentMargin: dec(r.manualSellingPrice ?? 0).gt(0)
            ? dec(r.manualSellingPrice)
                .sub(c.costPerUnit)
                .div(r.manualSellingPrice)
                .mul(100)
                .toString()
            : c.marginPercent,
        };
      } catch (e) {
        return { name: r.name, error: e.message };
      }
    });
  const logs = waste.filter((w) => w.date >= since && w.date <= until),
    grouped = {};
  for (const w of logs) {
    const k = `${w.materialName} · ${w.reason}`;
    grouped[k] = new D(grouped[k] || 0).add(w.totalCostLost).toString();
  }
  return {
    recipes,
    batches,
    plans: sheets.filter((s) => s.status === "scheduled"),
    waste: logs,
    wasteByReason: grouped,
    wasteCost: logs
      .reduce((a, w) => a.add(w.totalCostLost), new D(0))
      .toString(),
    prices: prices.filter(
      (p) => p.effectiveAt >= since && p.effectiveAt <= until,
    ),
    finishedStock: sheets
      .filter((s) => s.status === "completed")
      .flatMap((s) =>
        (s.actual?.outputs || []).map((o) => {
          const discarded = waste
            .filter(
              (w) =>
                String(w.productionId) === String(s._id) &&
                w.type === "finished_good" &&
                (o.lineId != null
                  ? w.outputLineId === o.lineId
                  : w.materialName === o.recipeName),
            )
            .reduce((a, w) => a.add(w.quantity), new D(0));
          return {
            batch: s.referenceName || s.code,
            recipeName: o.recipeName,
            quantity: D.max(0, dec(o.quantity).sub(discarded)).toString(),
            uom: o.uom,
            unitCost: o.unitCost,
          };
        }),
      ),
    movements: movements.filter(
      (m) => m.createdAt >= since && m.createdAt <= until,
    ),
    stock: [...m.materials.values()].filter((m) =>
      ["ingredient", "packaging"].includes(m.type),
    ),
    purchases: (await read(O.Purchase)).filter(
      (p) => p.createdAt >= since && p.createdAt <= until,
    ),
    receipts: (await read(O.Receipt)).filter(
      (r) => r.receivedAt >= since && r.receivedAt <= until,
    ),
  };
});
exports.revisions = handler(async (req) => ({
  revisions: await O.Revision.find({ recipeId: id(req.params.id) })
    .sort({ version: -1 })
    .lean(),
}));
exports.migrationPreview = handler(async (req) => {
  if (!Array.isArray(req.body.items) || req.body.items.length > 200)
    throw ApiError.badRequest("Supply up to 200 legacy items for review");
  return {
    suggestions: req.body.items.map((item) => {
      const match = String(item.name).match(
        /\((\d+(?:\.\d+)?)\s*(kg|gm|g|ml|ltr|l)\)/i,
      );
      const packUom = match
        ? { gm: "g", ltr: "L", l: "L" }[match[2].toLowerCase()] ||
          match[2].toLowerCase()
        : null;
      const baseUom = ["kg", "g"].includes(packUom) ? "g" : "ml";
      return {
        name: item.name,
        packQuantity: match?.[1] || null,
        packUom,
        baseUom,
        purchasePrice: item.cost ?? null,
        effectiveUnitCost:
          match && item.cost != null
            ? E.calculateEffectiveUnitCost(
                match[1],
                packUom,
                item.cost,
                baseUom,
              )
            : null,
        needsReview: true,
      };
    }),
  };
});
exports._test = { maps, simulate, transaction };
