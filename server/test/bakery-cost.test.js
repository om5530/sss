const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/services/bakeryCost.service");
test("Pack acceptance examples retain decimal precision", () => {
  for (const [qty, uom, price, base, expected] of [
    [1, "kg", 58, "g", "0.058"],
    [500, "g", 310, "g", "0.62"],
    [200, "g", 35, "g", "0.175"],
    [1, "L", 78, "ml", "0.078"],
    [1, "L", 150, "ml", "0.15"],
  ])
    assert.equal(E.calculateEffectiveUnitCost(qty, uom, price, base), expected);
  assert.equal(
    E.calculateEffectiveUnitCost(225, "g", 330, "g"),
    "1.466666666666666666666666666666666666667",
  );
});
test("Conversions reject invalid dimensions and require explicit density", () => {
  assert.equal(E.convertUnits(1, "kg", "mg"), "1000000");
  assert.equal(E.convertUnits(1, "L", "g", "1.03"), "1030");
  assert.equal(E.convertUnits(1, "dozen", "piece"), "12");
  assert.equal(E.convertUnits(1, "hour", "minute"), "60");
  for (const args of [
    [1, "g", "ml"],
    [1, "box", "piece"],
    [1, "g", "hour"],
    [1, "unknown", "g"],
    [-1, "g", "g"],
  ])
    assert.throws(() => E.convertUnits(...args));
  assert.throws(() => E.calculateEffectiveUnitCost(0, "g", 1, "g"));
});
test("Historical butter cake exact total is 162.116; zero markup is respected", () => {
  const rows = [
    [192, ".058", "g"],
    [4, ".4", "g"],
    [3, ".4", "g"],
    [1, ".03", "g"],
    [70, ".62", "g"],
    [9, ".15", "ml"],
    [150, ".05", "g"],
    [250, ".078", "ml"],
    [5, ".08", "ml"],
    [60, ".6", "minute", "resource"],
    [2, "20", "piece", "labour"],
  ];
  const map = new Map(
    rows.map((r, i) => [
      String(i),
      {
        name: String(i),
        effectiveUnitCost: r[1],
        baseUom: r[2],
        type: r[3] || "ingredient",
      },
    ]),
  );
  const r = E.evaluateRecipeCost(
    {
      name: "Cake",
      yieldQuantity: 1,
      targetMarkupPercent: 0,
      components: rows.map((r, i) => ({
        materialId: String(i),
        quantity: r[0],
        uom: r[2],
      })),
    },
    map,
  );
  assert.equal(r.totalBatchCost, "162.116");
  assert.equal(r.suggestedSellingPrice, "162.116");
  assert.equal(r.resourceCost, "36");
  assert.equal(r.labourCost, "40");
});
test("Markup and margin are distinct and invalid margins rejected", () => {
  const p = E.calculatePricing(292, 50);
  assert.equal(p.suggestedSellingPrice, "438");
  assert.equal(p.profit, "146");
  assert.ok(p.marginPercent.startsWith("33.333333"));
  assert.equal(
    E.calculatePriceFromMargin(292, 50).suggestedSellingPrice,
    "584",
  );
  assert.throws(() => E.calculatePriceFromMargin(292, 100));
});
test("Hourly oven cost scales by capacity, not by a multiplied hourly rate", () => {
  const m = new Map([
    [
      "oven",
      {
        name: "Oven",
        type: "resource",
        baseUom: "hour",
        packQuantity: "1",
        packUom: "hour",
        purchasePrice: "36",
      },
    ],
  ]);
  const r = {
    name: "Cake",
    yieldQuantity: 1,
    components: [
      {
        materialId: "oven",
        quantity: 60,
        uom: "minute",
        scalingMethod: "stepped",
        capacityPerCycle: 4,
        cycleMinutes: 60,
      },
    ],
  };
  for (const [qty, cost] of [
    [1, "36"],
    [4, "36"],
    [5, "72"],
    [7, "72"],
  ])
    assert.equal(E.scaleRecipeForQuantity(r, qty, m).totalCost, cost);
});
test("Mixed units aggregate in base units, including nested recipes and packaging shortages", () => {
  const m = new Map([
    [
      "flour",
      {
        name: "Flour",
        type: "ingredient",
        baseUom: "g",
        packQuantity: 1,
        packUom: "kg",
        purchasePrice: 58,
        currentStock: 200,
        allocatedStock: 100,
      },
    ],
    [
      "box",
      {
        name: "Box",
        type: "packaging",
        baseUom: "box",
        packQuantity: 1,
        packUom: "box",
        purchasePrice: 20,
        currentStock: 0,
      },
    ],
  ]);
  const sub = {
    _id: "sub",
    name: "Mix",
    yieldQuantity: 1000,
    yieldUom: "g",
    components: [{ materialId: "flour", quantity: 1, uom: "kg" }],
  };
  const parent = {
    _id: "parent",
    name: "Cake",
    yieldQuantity: 1,
    components: [
      {
        componentType: "sub_recipe",
        subRecipeId: "sub",
        quantity: 500,
        uom: "g",
      },
      { materialId: "flour", quantity: 1, uom: "kg" },
      { materialId: "box", quantity: 1, uom: "box" },
    ],
  };
  const r = E.aggregateMultiProductRequirements(
    [{ recipe: parent, quantity: 1 }],
    m,
    new Map([["sub", sub]]),
  );
  assert.equal(r.ingredients[0].quantity, "1500");
  assert.equal(r.ingredients[0].shortage, "1400");
  assert.equal(r.ingredients[0].packsNeeded, "2");
  assert.equal(r.packaging[0].shortage, "1");
  assert.equal(r.totalCost, "107");
  sub.components = [
    {
      componentType: "sub_recipe",
      subRecipeId: "parent",
      quantity: 1,
      uom: "piece",
    },
  ];
  assert.throws(
    () =>
      E.scaleRecipeForQuantity(
        parent,
        1,
        m,
        new Map([
          ["sub", sub],
          ["parent", parent],
        ]),
      ),
    /Circular/,
  );
});
test("Weight requests, fixed batch costs and missing materials are deterministic", () => {
  const r = {
    name: "Cake",
    yieldQuantity: 1,
    yieldUom: "cake",
    finishedWeightGrams: 600,
    components: [
      {
        componentType: "other",
        name: "Setup",
        quantity: 1,
        unitCost: 10,
        scalingMethod: "fixed",
      },
    ],
  };
  assert.equal(
    E.scaleRecipeForQuantity(r, "1.2", new Map(), new Map(), { uom: "kg" })
      .totalCost,
    "20",
  );
  assert.throws(() => E.scaleRecipeForQuantity(r, 0));
  assert.throws(
    () =>
      E.evaluateRecipeCost({
        ...r,
        components: [{ materialId: "missing", quantity: 1, uom: "g" }],
      }),
    /unavailable/,
  );
});
