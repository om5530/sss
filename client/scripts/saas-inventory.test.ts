import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../src/app/core/services/auth.service';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasInventory } from '../src/app/pages/saas-lab/saas-inventory';
import { loadPendingInventory, savePendingInventory, clearPendingInventory } from '../src/app/core/utils/saas-inventory-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const material = { _id: '400000000000000000000001', name: 'Flour', type: 'ingredient', active: true, packUom: 'g', version: 1 };
const quote = { materialId: material._id, materialName: 'Flour', kind: 'opening', quantity: '1000', unit: 'g', before: '0', after: '1000', estimatedCostPaise: '10000', stockVersion: 1, reason: 'Initial count' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
async function setup(t: any, overrides: Record<string, unknown> = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = storage(); Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true });
  const calls: any[] = []; const api = { materials: () => of({ items: [material], nextCursor: null }), inventory: () => of({ stocks: [], nextCursor: null }), inventoryQuote: () => of(quote),
    recordInventory: (...args: any[]) => { calls.push(args); return of({ entry: quote, replayed: false }); }, materialHistory: () => of({ entries: [], nextCursor: null }), ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }, { provide: AuthService, useValue: { user: () => ({ id: actor }) } }] });
  const page = runInInjectionContext(injector, () => new SaasInventory()) as any; page.bakeryId = bakery; page.ngOnChanges(); await tick();
  t.after(() => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; }); return { page, store, calls };
}
async function review(page: any) { page.form = { materialId: material._id, kind: 'opening', quantity: '1000', uom: 'g', reason: 'Initial count' }; await page.prepare(); assert.ok(page.reviewing()); }
test('inventory review freezes the counted quantity and requires confirmation before writing', async t => {
  const { page, calls, store } = await setup(t); await review(page); assert.equal(calls.length, 0); assert.equal(store.values.size, 0);
  page.form.quantity = '2000'; await page.confirm(); assert.equal(calls[0][1].quantity, '1000'); assert.equal(calls[0][1].expectedStockVersion, 0); assert.equal(page.pending(), null); assert.equal(store.values.size, 0);
});
test('inventory lost responses survive reload and retry the exact original key', async t => {
  let count = 0; const sent: any[] = []; const { page, store } = await setup(t, { recordInventory: (_id: string, input: unknown) => { sent.push(structuredClone(input)); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ entry: quote, replayed: true }); } });
  await review(page); await page.confirm(); page.ngOnChanges(); await tick(); assert.deepEqual(loadPendingInventory(store, actor, bakery)?.input, sent[0]);
  await page.prepare(); assert.equal(page.reviewing(), null); page.reviewPending(); await page.confirm(); assert.deepEqual(sent[1], sent[0]); assert.equal(page.pending(), null); assert.match(page.notice(), /existing entry/);
});
test('unavailable recovery storage sends no movement and key conflicts keep the recovery record', async t => {
  let sent = 0; const { page, store } = await setup(t, { recordInventory: () => { sent++; return throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'INVENTORY_KEY_CONFLICT' } } })); } });
  await review(page); const set = store.setItem; store.setItem = () => {}; await page.confirm(); assert.equal(sent, 0); store.setItem = set;
  await page.confirm(); assert.equal(sent, 1); assert.ok(page.pending()); assert.ok(loadPendingInventory(store, actor, bakery));
});
test('only definitive inventory rejection discards pending recovery', async t => {
  const { page, store } = await setup(t, { recordInventory: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Inventory changed', details: { code: 'INVENTORY_REJECTED' } } })) });
  await review(page); await page.confirm(); assert.equal(page.pending(), null); assert.equal(store.values.size, 0); assert.match(page.error(), /changed/);
});
test('late inventory quote and history responses cannot replace the selected bakery', async t => {
  const response = new Subject<any>(), history = new Subject<any>(); const { page } = await setup(t, { inventoryQuote: () => response, materialHistory: () => history });
  page.form = { materialId: material._id, kind: 'opening', quantity: '1000', uom: 'g', reason: 'Initial count' }; const preparing = page.prepare(); page.bakeryId = other; page.ngOnChanges(); await tick(); response.next(quote); await preparing; assert.equal(page.reviewing(), null);
  const loading = page.loadHistory(material._id); page.clearHistory(); history.next({ entries: [quote], nextCursor: null }); await loading; assert.deepEqual(page.history(), []);
});
test('inventory costs start hidden and page visibility loss hides revealed estimates', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'), document = Object.assign(new EventTarget(), { hidden: false }); Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const { page } = await setup(t); t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  assert.equal(page.showCosts(), false); page.showCosts.set(true); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(page.showCosts(), false);
});
test('inventory recovery is tenant/actor scoped and rejects replacement, invalid quantity and failed cleanup', () => {
  const store = storage(), pending = { materialName: 'Flour', input: { materialId: material._id, kind: 'opening' as const, quantity: '0', uom: 'g' as const, expectedMaterialVersion: 1, expectedStockVersion: 0, reason: 'Counted empty', confirmed: true as const, idempotencyKey: randomUUID() } };
  savePendingInventory(store, actor, bakery, pending); assert.deepEqual(loadPendingInventory(store, actor, bakery), pending); assert.equal(loadPendingInventory(store, actor, other), null); assert.equal(loadPendingInventory(store, other, bakery), null);
  assert.throws(() => savePendingInventory(store, actor, bakery, { ...pending, input: { ...pending.input, quantity: '1' } })); assert.throws(() => clearPendingInventory(store, actor, bakery, randomUUID()));
  assert.throws(() => clearPendingInventory({ ...store, removeItem: () => {} }, actor, bakery, pending.input.idempotencyKey)); clearPendingInventory(store, actor, bakery, pending.input.idempotencyKey);
  assert.throws(() => savePendingInventory(store, actor, bakery, { ...pending, input: { ...pending.input, kind: 'receipt', expectedStockVersion: 1 } }));
  savePendingInventory(store, actor, bakery, pending); store.values.set([...store.values.keys()][0], '{broken'); assert.throws(() => loadPendingInventory(store, actor, bakery));
});

test('a tracked physical count correction may safely set an empty balance', () => {
  const store = storage(), pending = { materialName: 'Flour', input: { materialId: material._id, kind: 'count' as const, quantity: '0', uom: 'g' as const, expectedMaterialVersion: 1, expectedStockVersion: 2, reason: 'Physically empty', confirmed: true as const, idempotencyKey: randomUUID() } };
  savePendingInventory(store, actor, bakery, pending); assert.deepEqual(loadPendingInventory(store, actor, bakery), pending);
});
