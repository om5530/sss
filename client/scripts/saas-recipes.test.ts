import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasRecipes } from '../src/app/pages/saas-lab/saas-recipes';
import { parseRupeesToPaise } from '../src/app/core/utils/saas-money';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const material = { _id: 'material-1', name: 'Flour', type: 'ingredient', packQuantity: '1000', packUom: 'g', purchasePricePaise: 10000, active: true, version: 2 };
const recipe = { _id: 'family-1', name: 'Biscoff', category: 'Cakes', version: 1, latestRevisionNumber: 1, archived: false };
const revision = { _id: 'revision-1', recipeId: recipe._id, revisionNumber: 1, yieldPieces: 8, label: '8 pieces', notes: '', overheadPaise: 0, batchCostPaise: '2000', unitCostPaise: '250',
  ingredients: [{ materialId: material._id, materialVersion: 1, name: material.name, quantity: '200', uom: 'g', costPaise: '2000' }] };
const product = { _id: 'product-1', name: 'Biscoff', version: 4, pricePaise: 19900, recipeId: null, recipeRevisionId: null };

async function setup(overrides: Record<string, unknown> = {}) {
  const calls: { action: string; args: any[] }[] = [];
  const api = {
    materials: () => of({ items: [material], nextCursor: null }), recipes: () => of({ items: [recipe], nextCursor: null }),
    products: () => of({ products: [product], nextCursor: null }), recipe: () => of({ recipe, revisions: [revision], nextBefore: null }),
    createRevision: (...args: any[]) => { calls.push({ action: 'revision', args }); return of({ recipe: { ...recipe, version: 2, latestRevisionNumber: 2 }, revision: { ...revision, _id: 'revision-2', revisionNumber: 2 } }); },
    createMaterial: (...args: any[]) => { calls.push({ action: 'material', args }); return of(material); },
    mapRecipe: (...args: any[]) => { calls.push({ action: 'mapping', args }); return of({ _id: product._id, recipeId: recipe._id, recipeRevisionId: revision._id, version: 5 }); },
    ...overrides,
  };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }] });
  const page = runInInjectionContext(injector, () => new SaasRecipes()) as any;
  page.bakeryId = 'a'; await page.refresh();
  return { page, calls, cleanup: () => { page.ngOnDestroy(); injector.destroy(); } };
}

test('new recipe revisions reference current material versions while retaining the saved revision snapshot', async () => {
  const { page, calls, cleanup } = await setup(); page.familyId = recipe._id; await page.loadFamily();
  const saved = JSON.stringify(page.selectedRevision()); page.begin('revision'); page.form.yieldPieces = 9; await page.saveRecipe();
  assert.equal(calls[0].action, 'revision'); assert.equal(calls[0].args[0], 'a'); assert.equal(calls[0].args[1], recipe._id);
  assert.equal(calls[0].args[2].expectedVersion, 1); assert.equal(calls[0].args[2].ingredients[0].expectedVersion, 2);
  assert.equal(calls[0].args[2].yieldPieces, 9); assert.equal(JSON.stringify(revision), saved);
  assert.equal(page.detail().revisions.length, 2); assert.equal(page.selectedRevision().revisionNumber, 2);
  cleanup();
});

test('stale revision saves retain the draft and do not modify the family or mapping', async () => {
  const { page, calls, cleanup } = await setup({ createRevision: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Material changed' } })) });
  page.familyId = recipe._id; await page.loadFamily(); page.begin('revision'); page.form.label = 'My draft'; await page.saveRecipe();
  assert.equal(page.editing(), 'revision'); assert.equal(page.form.label, 'My draft'); assert.equal(page.detail().recipe.version, 1);
  assert.equal(page.products()[0].recipeRevisionId, null); assert.equal(calls.length, 0); assert.equal(page.busy(), false);
  cleanup();
});

test('mapping sends one explicit selected revision and the product version without altering the selling price', async () => {
  const { page, calls, cleanup } = await setup(); page.familyId = recipe._id; await page.loadFamily(); page.mappingProductId = product._id;
  await page.mapProduct(); assert.deepEqual(calls[0].args, ['a', product._id, revision._id, 4]);
  assert.equal(page.products()[0].recipeRevisionId, revision._id); assert.equal(page.products()[0].pricePaise, 19900);
  await page.mapProduct(true); assert.deepEqual(calls[1].args, ['a', product._id, null, 5]);
  cleanup();
});

test('switching bakery clears form contents and ignores delayed responses from the previous bakery', async () => {
  const slow = new Subject<any>(); let count = 0;
  const { page, cleanup } = await setup({ materials: () => ++count === 2 ? slow : of({ items: [material], nextCursor: null }) });
  page.materialForm.name = 'A private ingredient'; page.materialForm.price = '123.45'; page.notice.set('A private notice');
  const first = page.refresh(); page.bakeryId = 'b'; const second = page.refresh(); await second;
  assert.equal(page.materialForm.name, ''); assert.equal(page.materialForm.price, ''); assert.equal(page.notice(), '');
  slow.next({ items: [{ ...material, name: 'A-only secret' }], nextCursor: 'old' }); await first;
  assert.equal(page.materials()[0].name, 'Flour'); assert.equal(page.materialCursor(), null);
  cleanup();
});

test('material pricing and revision overhead reject extra precision and allow zero-price ingredients', async () => {
  const { page, calls, cleanup } = await setup(); page.materialForm.price = '1.005'; await page.saveMaterial(); assert.equal(calls.length, 0);
  page.materialForm = { name: 'Free packaging', type: 'packaging', packQuantity: '1', packUom: 'piece', price: '0.00' };
  await page.saveMaterial(); assert.equal(calls[0].args[1].purchasePricePaise, 0);
  for (const [input, expected] of [['0.10', 10], ['199.99', 19999], ['1000000', 100000000], ['0', 0]] as const) assert.equal(parseRupeesToPaise(input), expected);
  for (const input of ['1.005', '1e3', '-1', '1000000.01', '']) assert.equal(parseRupeesToPaise(input), null);
  cleanup();
});

test('leaving the workspace ignores a late material-save response', async () => {
  const slow = new Subject<any>(); const { page, cleanup } = await setup({ createMaterial: () => slow });
  page.materialForm = { name: 'New', type: 'ingredient', packQuantity: '1', packUom: 'g', price: '1' };
  const save = page.saveMaterial(); const before = page.materials(); cleanup(); slow.next({ ...material, _id: 'new-id' }); await save;
  assert.deepEqual(page.materials(), before);
});
