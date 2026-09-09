const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, server, base, adminToken, customerToken;

const json = (method, path, body, token = adminToken) => fetch(base + path, {
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = require('../src/app').listen(0);
  base = 'http://127.0.0.1:' + server.address().port + '/api';

  const User = require('../src/models/User');
  const { signToken } = require('../src/services/token.service');
  adminToken = signToken(await User.create({ name: 'Bakery Admin', role: 'admin' }));
  customerToken = signToken(await User.create({ name: 'Regular Customer', role: 'customer' }));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});

test('Bakery API security: guest and customer are rejected, admin is allowed', async () => {
  // Guest
  const resGuest = await json('GET', '/admin/bakery/materials', undefined, null);
  assert.equal(resGuest.status, 401);

  // Customer
  const resCust = await json('GET', '/admin/bakery/materials', undefined, customerToken);
  assert.equal(resCust.status, 403);

  // Admin
  const resAdmin = await json('GET', '/admin/bakery/materials', undefined, adminToken);
  assert.equal(resAdmin.status, 200);
});

test('Material lifecycle: create with pack pricing, auto-calculates effectiveUnitCost and converts units', async () => {
  const payload = {
    name: 'Callebaut Dark Chocolate Callets',
    category: 'ingredient',
    baseUnit: 'g',
    packQuantity: 2500, // 2.5 kg pack
    packUnit: 'g',
    purchasePrice: 2750, // ₹2750 per pack
    currentStock: 5000,
    minStockAlert: 1000,
    supplier: 'Callebaut Direct',
  };

  const createRes = await json('POST', '/admin/bakery/materials', payload);
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.material.name, 'Callebaut Dark Chocolate Callets');
  // 2750 / 2500 = 1.10 per gram
  assert.equal(created.material.effectiveUnitCost, 1.1);

  // Update pack price (inflation: price rises to ₹3000)
  const patchRes = await json('PATCH', `/admin/bakery/materials/${created.material._id}`, {
    purchasePrice: 3000,
  });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  // 3000 / 2500 = 1.20 per gram
  assert.equal(updated.material.effectiveUnitCost, 1.2);
});

test('Recipe simulation endpoint: accurate costing, markup, and gross margin', async () => {
  const BakeryMaterial = require('../src/models/BakeryMaterial');
  const flour = await BakeryMaterial.create({
    name: 'Cake Flour',
    category: 'ingredient',
    baseUnit: 'g',
    packQuantity: 1000,
    packUnit: 'g',
    purchasePrice: 60,
    currentStock: 10000,
  });
  const butter = await BakeryMaterial.create({
    name: 'Unsalted Butter',
    category: 'ingredient',
    baseUnit: 'g',
    packQuantity: 500,
    packUnit: 'g',
    purchasePrice: 300,
    currentStock: 5000,
  });

  const recipePayload = {
    name: 'Pound Cake',
    category: 'cake',
    yieldQuantity: 1,
    yieldUnit: 'piece',
    targetMarkupPercent: 60,
    materials: [
      { material: flour._id, quantity: 200 }, // 200g * (60/1000 = 0.06) = 12
      { material: butter._id, quantity: 200 }, // 200g * (300/500 = 0.60) = 120
    ],
    packaging: [],
    labourMinutes: 10,
    labourHourlyRate: 120, // 10 min @ ₹120/hr = ₹20
    ovenCycles: 1,
    ovenCycleCost: 30, // 1 cycle @ ₹30 = ₹30
  };

  const simRes = await json('POST', '/admin/bakery/simulate/recipe', {
    recipeData: recipePayload,
    quantity: 2,
    targetMarkup: 50,
  });
  assert.equal(simRes.status, 200);
  const sim = await simRes.json();
  assert.equal(sim.success, true);
  // Total cost per unit = 12 (flour) + 120 (butter) + 20 (labour) + 30 (oven) = 182
  // For 2 units: 182 * 2 = 364
  assert.equal(sim.scaled.totalCost, 364);
  assert.equal(sim.scaled.costPerUnit, 182);
  // 50% markup on 364 = 364 * 1.5 = 546
  assert.equal(sim.scaled.suggestedSellingPrice, 546);
  assert.equal(sim.scaled.profit, 182);
  assert.equal(Math.round(sim.scaled.marginPercent * 100) / 100, 33.33);
});

test('Multi-product plan simulation: aggregated grocery BOM and shortage detection', async () => {
  const BakeryMaterial = require('../src/models/BakeryMaterial');
  const sugar = await BakeryMaterial.create({
    name: 'Fine Sugar',
    category: 'ingredient',
    baseUnit: 'g',
    packQuantity: 1000,
    packUnit: 'g',
    purchasePrice: 40,
    currentStock: 300, // Only 300g on shelf!
  });

  const BakeryRecipe = require('../src/models/BakeryRecipe');
  const recipeA = await BakeryRecipe.create({
    name: 'Sugar Cookies',
    yieldQuantity: 10,
    yieldUom: 'piece',
    components: [{ materialId: sugar._id, quantity: 500, uom: 'g' }], // 500g for 10 cookies = 50g/cookie
  });

  // We want to bake 20 cookies (requires 1000g sugar)
  const planRes = await json('POST', '/admin/bakery/simulate/multi', {
    items: [{ recipeId: recipeA._id, quantity: 20 }],
  });
  assert.equal(planRes.status, 200);
  const planData = await planRes.json();
  assert.equal(planData.success, true);

  const sugarReq = planData.aggregated.ingredients.find(r => r.name === 'Fine Sugar');
  assert.ok(sugarReq);
  assert.equal(sugarReq.quantity, 1000);
  assert.equal(sugarReq.currentStock, 300);
  assert.equal(sugarReq.shortage, 700);
  // Pack size is 1000g, shortage is 700g -> ceil(700/1000) = 1 pack to purchase
  assert.equal(sugarReq.packsNeeded, 1);
});

test('Stock adjustment and Waste logging updates stock and tracks financial loss', async () => {
  const BakeryMaterial = require('../src/models/BakeryMaterial');
  const eggs = await BakeryMaterial.create({
    name: 'Farm Fresh Eggs',
    category: 'ingredient',
    baseUnit: 'piece',
    packQuantity: 30, // tray of 30
    packUnit: 'piece',
    purchasePrice: 210, // ₹7 per egg
    currentStock: 60,
  });

  // Adjust stock: add 1 pack (+30 eggs)
  const adjustRes = await json('PATCH', `/admin/bakery/inventory/${eggs._id}/stock`, {
    adjustment: 30,
    reason: 'Received shipment',
  });
  assert.equal(adjustRes.status, 200);
  const updatedMat = await adjustRes.json();
  assert.equal(updatedMat.material.currentStock, 90);

  // Log waste: 6 eggs dropped/broken
  const wasteRes = await json('POST', '/admin/bakery/waste', {
    material: eggs._id,
    quantity: 6,
    reason: 'dropped',
    notes: 'Dropped tray during morning prep',
  });
  assert.equal(wasteRes.status, 201);
  const wasteData = await wasteRes.json();
  assert.equal(wasteData.waste.quantity, 6);
  // 6 eggs * ₹7 = ₹42 loss
  assert.equal(wasteData.waste.totalCostLost, 42);

  // Check inventory stock deducted
  const reloaded = await BakeryMaterial.findById(eggs._id);
  assert.equal(reloaded.currentStock, 84); // 90 - 6 = 84
});
