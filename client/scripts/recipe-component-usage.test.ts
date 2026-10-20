import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRecipeComponentQuantity } from '../src/app/pages/admin/bakery/recipes/recipe-component-usage.ts';

test('editing oven usage overrides legacy hidden capacity scaling', () => {
  const oven = { componentType: 'material', itemType: 'resource', quantity: 180,
    scalingMethod: 'stepped', capacityPerCycle: 4, cycleMinutes: 60 } as any;
  setRecipeComponentQuantity(oven, 50);
  assert.equal(oven.quantity, 50);
  assert.equal(oven.scalingMethod, 'linear');
});

test('ingredient and fixed direct cost edits retain their scaling rules', () => {
  for (const component of [
    { componentType: 'material', itemType: 'ingredient', scalingMethod: 'linear' },
    { componentType: 'other', itemType: 'other', scalingMethod: 'fixed' },
  ]) {
    const original = component.scalingMethod;
    setRecipeComponentQuantity(component as any, 50);
    assert.equal(component.scalingMethod, original);
  }
});
