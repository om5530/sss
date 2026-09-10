process.env.NODE_ENV = "test";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
let db,
  server,
  base,
  token,
  flour,
  recipe,
  plan,
  formatId,
  supplierId,
  purchase;
async function api(method, path, body, auth = token) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json()) };
}
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  const User = require("../src/models/User");
  const u = await User.create({
    name: "Baker",
    phone: "+919999999999",
    role: "admin",
  });
  token = require("../src/services/token.service").signToken(u);
  for (const m of Object.values(require("../src/models/BakeryOperations")))
    await m.init();
  await new Promise(
    (resolve) => (server = require("../src/app").listen(0, resolve)),
  );
  base = `http://127.0.0.1:${server.address().port}/api/admin/bakery`;
});
after(async () => {
  await new Promise((r) => server?.close(r));
  await mongoose.disconnect();
  await db?.stop();
});
test("Bakery operations requires admin authentication", async () => {
  assert.equal((await api("GET", "/materials", undefined, null)).status, 401);
});
test("Create materials with exact rates, supplier history and opening ledger", async () => {
  let r = await api("POST", "/materials", {
    name: "Flour",
    baseUom: "g",
    packQuantity: "1",
    packUom: "kg",
    purchasePrice: "58",
    currentStock: "2000",
    supplierName: "Mill",
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  flour = r.material;
  assert.equal(flour.effectiveUnitCost, "0.058");
  r = await api("GET", "/purchasing");
  assert.equal(r.prices.length, 1);
  formatId = r.formats[0]._id;
  supplierId = r.suppliers[0]._id;
  const inv = await api("GET", "/inventory");
  assert.equal(inv.movements[0].type, "opening");
});
test("Server validates recipes, prices and zero markup", async () => {
  const r = await api("POST", "/recipes", {
    name: "Flour bake",
    yieldQuantity: "1",
    yieldUom: "piece",
    finishedWeightGrams: "400",
    targetMarkupPercent: "0",
    components: [{ materialId: flour._id, quantity: "500", uom: "g" }],
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  recipe = r.recipe;
  assert.equal(recipe.totalBatchCost, "29");
  assert.equal(recipe.suggestedSellingPrice, "29");
  assert.equal(
    (
      await api("POST", "/simulate/recipe", {
        recipeId: recipe._id,
        quantity: 0,
      })
    ).status,
    400,
  );
});
test("Saved plan recalculates tampered totals and allocates packaging/material stock", async () => {
  const r = await api("POST", "/costing-sheets", {
    type: "production_plan",
    referenceName: "Tomorrow",
    items: [{ recipeId: recipe._id, quantity: 2 }],
    totalCost: "0",
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  plan = r.sheet;
  assert.equal(plan.snapshot.totalCost, "58");
  const inv = await api("GET", "/inventory");
  assert.equal(inv.materials[0].allocatedStock, "1000");
  assert.equal(inv.materials[0].available, "1000");
});
test("Effective price updates projection but preserves historical snapshot", async () => {
  let r = await api("POST", `/formats/${formatId}/prices`, {
    purchasePrice: "70",
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  r = await api("GET", `/costing-sheets/${plan._id}/recalculate`);
  assert.equal(r.historical.totalCost, "58");
  assert.equal(r.current.totalCost, "70");
  const recipes = await api("GET", "/recipes");
  assert.equal(recipes.recipes[0].totalBatchCost, "35");
});
test("Purchase order does not add stock; partial receiving is atomic and idempotent", async () => {
  let r = await api("POST", "/purchases", {
    supplierId,
    lines: [{ formatId, packs: "3" }],
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  purchase = r.purchase;
  assert.equal(
    (await api("GET", "/inventory")).materials[0].currentStock,
    "2000",
  );
  await api("POST", `/purchases/${purchase._id}/status`, { status: "ordered" });
  const payload = {
    operationKey: "receipt-test-1",
    lines: [
      { lineId: purchase.lines[0].lineId, packs: "1", purchasePrice: "72" },
    ],
  };
  r = await api("POST", `/purchases/${purchase._id}/receive`, payload);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.purchase.status, "partially_received");
  await api("POST", `/purchases/${purchase._id}/receive`, payload);
  assert.equal(
    (await api("GET", "/inventory")).materials[0].currentStock,
    "3000",
  );
  assert.equal(
    (
      await api("POST", `/purchases/${purchase._id}/receive`, {
        operationKey: "receipt-test-2",
        lines: [{ lineId: purchase.lines[0].lineId, packs: "5" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await api("GET", "/inventory")).materials[0].currentStock,
    "3000",
  );
});
test("Production records actual usage, snapshots and idempotent stock consumption", async () => {
  const payload = {
    operationKey: "production-test-1",
    ingredients: [{ materialId: flour._id, quantity: "1050" }],
    outputs: [{ recipeId: recipe._id, quantity: "1.8", waste: ".2" }],
  };
  let r = await api("POST", `/costing-sheets/${plan._id}/complete`, payload);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.sheet.actual.totalCost, "60.9");
  assert.equal(r.sheet.actual.consumption[0].variance, "50");
  await api("POST", `/costing-sheets/${plan._id}/complete`, payload);
  const inv = await api("GET", "/inventory");
  assert.equal(inv.materials[0].currentStock, "1950");
  assert.equal(inv.materials[0].allocatedStock, "0");
});
test("Invalid waste leaves inventory unchanged; explicit units are converted", async () => {
  let r = await api("POST", "/waste", {
    materialId: flour._id,
    quantity: 10,
    reason: "INVALID",
  });
  assert.ok(r.status >= 400);
  assert.equal(
    (await api("GET", "/inventory")).materials[0].currentStock,
    "1950",
  );
  r = await api("POST", "/waste", {
    materialId: flour._id,
    quantity: ".1",
    uom: "kg",
    reason: "Dropped",
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.waste.quantity, "100");
  assert.equal(r.waste.totalCostLost, "7.2");
});
test("Recipe graph prevents cycles and revision updates preserve old version", async () => {
  const sub = (
    await api("POST", "/recipes", {
      name: "Sub",
      yieldQuantity: 1,
      yieldUom: "piece",
      isSubRecipe: true,
      components: [
        {
          componentType: "sub_recipe",
          subRecipeId: recipe._id,
          quantity: 1,
          uom: "piece",
        },
      ],
    })
  ).recipe;
  let r = await api("PATCH", `/recipes/${recipe._id}`, {
    version: 1,
    components: [
      {
        componentType: "sub_recipe",
        subRecipeId: sub._id,
        quantity: 1,
        uom: "piece",
      },
    ],
  });
  assert.equal(r.status, 400);
  r = await api("PATCH", `/recipes/${recipe._id}`, {
    version: 1,
    name: "New recipe name",
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.recipe.version, 2);
  r = await api("GET", `/recipes/${recipe._id}/versions`);
  assert.equal(r.revisions.length, 2);
  assert.equal(r.revisions[1].recipe.name, "Flour bake");
});
test("Pack adjustment converts kilograms to grams and rejects stale stock counts", async () => {
  const before = (await api("GET", "/inventory")).materials[0].currentStock;
  const r = await api("PATCH", `/inventory/${flour._id}/stock`, { packs: "1" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(
    r.material.currentStock,
    require("../src/services/bakeryCost.service")
      .dec(before)
      .add(1000)
      .toString(),
  );
  assert.equal(
    (
      await api("PATCH", `/inventory/${flour._id}/stock`, {
        currentStock: "1",
        expectedStock: before,
      })
    ).status,
    409,
  );
});
test("Repeated recipes keep separate output and finished-waste quantities", async () => {
  const s = (
    await api("POST", "/costing-sheets", {
      type: "production_plan",
      items: [
        { recipeId: recipe._id, quantity: 1 },
        { recipeId: recipe._id, quantity: 2 },
      ],
    })
  ).sheet;
  const bad = await api("POST", `/costing-sheets/${s._id}/complete`, {
    operationKey: "duplicate-output-bad",
    outputs: [{ recipeId: recipe._id, quantity: 1 }],
  });
  assert.equal(bad.status, 400);
  const r = await api("POST", `/costing-sheets/${s._id}/complete`, {
    operationKey: "duplicate-output-good",
    outputs: [
      { lineId: "0", quantity: ".8", waste: ".2" },
      { lineId: "1", quantity: "1.9", waste: ".1" },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(
    r.sheet.actual.outputs.map((o) => o.quantity),
    ["0.8", "1.9"],
  );
  assert.equal(
    (
      await api("POST", "/waste", {
        productionId: s._id,
        lineId: "0",
        quantity: ".9",
        reason: "Unsold",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("POST", "/waste", {
        productionId: s._id,
        lineId: "1",
        quantity: ".9",
        reason: "Unsold",
      })
    ).status,
    200,
  );
});
test("Legacy migration preserves totals and is repeatable", async () => {
  const Legacy = require("../src/models/BakeryProduction"),
    O = require("../src/models/BakeryOperations");
  const old = await Legacy.create({
    code: "OLD-QUOTE",
    totalCost: 162.116,
    suggestedSellingPrice: 243.174,
    items: [],
  });
  const { migrate } = require("../src/utils/migrateBakery");
  assert.equal((await migrate(false)).legacySheets, 1);
  assert.equal(await O.Sheet.countDocuments({ code: `LEGACY-${old._id}` }), 0);
  await migrate(true);
  await migrate(true);
  assert.equal(await O.Sheet.countDocuments({ code: `LEGACY-${old._id}` }), 1);
  const copy = await O.Sheet.findOne({ code: `LEGACY-${old._id}` });
  assert.equal(copy.snapshot.totalCost, "162.116");
  assert.equal(copy.status, "draft");
  assert.equal((await Legacy.findById(old._id)).totalCost, 162.116);
});
test("Concurrent production cannot consume the same stock twice", async () => {
  const m = (
    await api("POST", "/materials", {
      name: "Limited butter",
      baseUom: "g",
      packQuantity: "500",
      packUom: "g",
      purchasePrice: "310",
      currentStock: "500",
      minimumStock: "200",
    })
  ).material;
  const r = (
    await api("POST", "/recipes", {
      name: "Limited batch",
      yieldQuantity: "1",
      yieldUom: "piece",
      components: [{ materialId: m._id, quantity: "400", uom: "g" }],
    })
  ).recipe;
  const p = [];
  for (let i = 0; i < 2; i++)
    p.push(
      (
        await api("POST", "/costing-sheets", {
          type: "production_plan",
          items: [{ recipeId: r._id, quantity: 1 }],
        })
      ).sheet,
    );
  const results = await Promise.all(
    p.map((s, i) =>
      api("POST", `/costing-sheets/${s._id}/complete`, {
        operationKey: "concurrent-batch-" + i,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const inv = await api("GET", "/inventory");
  assert.equal(inv.materials.find((x) => x._id === m._id).currentStock, "100");
  assert.ok(inv.lowStock.some((x) => x._id === m._id));
  const O = require("../src/models/BakeryOperations");
  assert.equal(
    await O.Movement.countDocuments({ materialId: m._id, type: "consumption" }),
    1,
  );
});
test("Reports include the entire India calendar day and reject reversed ranges", async () => {
  const day = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const r = await api("GET", `/reports?from=${day}&to=${day}`);
  assert.equal(r.status, 200);
  assert.ok(r.batches.length > 0);
  assert.ok(r.receipts.length > 0);
  assert.equal(
    (await api("GET", "/reports?from=2026-12-31&to=2026-01-01")).status,
    400,
  );
});
