const { test } = require('node:test');
const assert = require('node:assert/strict');
const costEngine = require('../src/services/bakeryCost.service');

test('Section 41 Acceptance Test: Raw Ingredient Unit Cost Conversions', () => {
  // Flour: 1kg = ₹58 -> ₹0.058/g
  const flourCost = costEngine.calculateEffectiveUnitCost(1, 'kg', 58, 'g');
  assert.equal(flourCost, 0.058);

  // Butter: 500g = ₹310 -> ₹0.62/g
  const butterCost = costEngine.calculateEffectiveUnitCost(500, 'g', 310, 'g');
  assert.equal(butterCost, 0.62);

  // Cocoa: 225g = ₹330 -> ₹1.466666666.../g
  const cocoaCost = costEngine.calculateEffectiveUnitCost(225, 'g', 330, 'g');
  assert.ok(Math.abs(cocoaCost - 330 / 225) < 0.00000001);
  assert.equal(cocoaCost.toFixed(4), '1.4667');

  // Caster Sugar: 200g = ₹35 -> ₹0.175/g
  const sugarCost = costEngine.calculateEffectiveUnitCost(200, 'g', 35, 'g');
  assert.equal(sugarCost, 0.175);

  // Milk: 1L = ₹78 -> ₹0.078/ml
  const milkCost = costEngine.calculateEffectiveUnitCost(1, 'L', 78, 'ml');
  assert.equal(milkCost, 0.078);

  // Oil: 1L = ₹150 -> ₹0.15/ml
  const oilCost = costEngine.calculateEffectiveUnitCost(1, 'L', 150, 'ml');
  assert.equal(oilCost, 0.15);
});

test('Section 41 Acceptance Test: Historical Butter Cake Exact Unrounded Cost = ₹162.116', () => {
  const flour = { effectiveUnitCost: 0.058, baseUom: 'g', type: 'ingredient' };
  const bakingPowder = { effectiveUnitCost: 0.40, baseUom: 'g', type: 'ingredient' };
  const bakingSoda = { effectiveUnitCost: 0.40, baseUom: 'g', type: 'ingredient' };
  const salt = { effectiveUnitCost: 0.03, baseUom: 'g', type: 'ingredient' };
  const butter = { effectiveUnitCost: 0.62, baseUom: 'g', type: 'ingredient' };
  const oil = { effectiveUnitCost: 0.15, baseUom: 'ml', type: 'ingredient' };
  const sugar = { effectiveUnitCost: 0.05, baseUom: 'g', type: 'ingredient' };
  const milk = { effectiveUnitCost: 0.078, baseUom: 'ml', type: 'ingredient' };
  const vinegar = { effectiveUnitCost: 0.08, baseUom: 'ml', type: 'ingredient' };
  const oven = { effectiveUnitCost: 0.60, baseUom: 'minute', type: 'resource' };
  const labour = { effectiveUnitCost: 20.0, baseUom: 'piece', type: 'labour' };

  const materialMap = new Map([
    ['flour', flour],
    ['bakingPowder', bakingPowder],
    ['bakingSoda', bakingSoda],
    ['salt', salt],
    ['butter', butter],
    ['oil', oil],
    ['sugar', sugar],
    ['milk', milk],
    ['vinegar', vinegar],
    ['oven', oven],
    ['labour', labour],
  ]);

  const butterCakeRecipe = {
    name: 'Classic Butter Cake',
    yieldQuantity: 1,
    components: [
      { materialId: 'flour', quantity: 192, uom: 'g' },
      { materialId: 'bakingPowder', quantity: 4, uom: 'g' },
      { materialId: 'bakingSoda', quantity: 3, uom: 'g' },
      { materialId: 'salt', quantity: 1, uom: 'g' },
      { materialId: 'butter', quantity: 70, uom: 'g' },
      { materialId: 'oil', quantity: 9, uom: 'ml' },
      { materialId: 'sugar', quantity: 150, uom: 'g' },
      { materialId: 'milk', quantity: 250, uom: 'ml' },
      { materialId: 'vinegar', quantity: 5, uom: 'ml' },
      { materialId: 'oven', quantity: 60, uom: 'minute', scalingMethod: 'linear' },
      { materialId: 'labour', quantity: 2, uom: 'piece', scalingMethod: 'linear' },
    ],
  };

  const result = costEngine.evaluateRecipeCost(butterCakeRecipe, materialMap);

  // Unrounded check
  const total = result.totalBatchCost;
  // 192 * 0.058 = 11.136
  // 4 * 0.4 = 1.6
  // 3 * 0.4 = 1.2
  // 1 * 0.03 = 0.03
  // 70 * 0.62 = 43.4
  // 9 * 0.15 = 1.35
  // 150 * 0.05 = 7.5
  // 250 * 0.078 = 19.5
  // 5 * 0.08 = 0.4
  // 60 * 0.60 = 36.0
  // 2 * 20 = 40.0
  // Total = 162.116
  assert.equal(Math.round(total * 1000) / 1000, 162.116);
  assert.equal(result.resourceCost, 36.0);
  assert.equal(result.labourCost, 40.0);
});

test('Section 41 Acceptance Test: Markup vs Margin Calculation', () => {
  // Cost: ₹292, Markup: 50% -> Selling: ₹438, Profit: ₹146, Gross Margin: 33.3333...%
  const pricing = costEngine.calculatePricing(292, 50);

  assert.equal(pricing.cost, 292);
  assert.equal(pricing.markupPercent, 50);
  assert.equal(pricing.suggestedSellingPrice, 438);
  assert.equal(pricing.profit, 146);
  assert.ok(Math.abs(pricing.marginPercent - (146 / 438) * 100) < 0.0001);
  assert.equal(pricing.marginPercent.toFixed(2), '33.33');
});

test('Stepped Capacity Oven Cost Scaling', () => {
  const oven = { effectiveUnitCost: 0.60, baseUom: 'minute', type: 'resource' };
  const materialMap = new Map([['oven', oven]]);

  const recipe = {
    name: 'Butter Cake',
    baseBatchUnits: 1,
    components: [
      {
        materialId: 'oven',
        quantity: 60,
        uom: 'minute',
        scalingMethod: 'stepped',
        capacityPerCycle: 4, // 4 cakes per cycle
        cycleMinutes: 60,
      },
    ],
  };

  // 1 cake -> 1 cycle = 60 min * 0.60 = ₹36
  const scaled1 = costEngine.scaleRecipeForQuantity(recipe, 1, materialMap);
  assert.equal(scaled1.resourceCost, 36);

  // 4 cakes -> 1 cycle = 60 min * 0.60 = ₹36
  const scaled4 = costEngine.scaleRecipeForQuantity(recipe, 4, materialMap);
  assert.equal(scaled4.resourceCost, 36);

  // 5 cakes -> 2 cycles = 120 min * 0.60 = ₹72
  const scaled5 = costEngine.scaleRecipeForQuantity(recipe, 5, materialMap);
  assert.equal(scaled5.resourceCost, 72);

  // 7 cakes -> 2 cycles = 120 min * 0.60 = ₹72
  const scaled7 = costEngine.scaleRecipeForQuantity(recipe, 7, materialMap);
  assert.equal(scaled7.resourceCost, 72);
});
