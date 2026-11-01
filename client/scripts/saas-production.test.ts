import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../src/app/core/services/auth.service';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasProduction } from '../src/app/pages/saas-lab/saas-production';
import { loadPendingProduction, savePendingProduction, clearPendingProduction } from '../src/app/core/utils/saas-production-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const product = { _id: '400000000000000000000001', name: 'Cake', recipeRevisionId: '500000000000000000000001', stockCount: 1, version: 2, archived: false };
const quote = { productName: 'Cake', producedPieces: 18, stockBefore: 1, stockAfter: 19, totalCostPaise: '20770', ingredients: [] };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
async function setup(t: any, overrides: Record<string, unknown> = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = storage();
  Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true });
  const calls: any[] = [];
  const api = { products: () => of({ products: [product], nextCursor: null }), productionRuns: () => of({ runs: [], nextCursor: null }), productionQuote: () => of(quote),
    recordProduction: (...args: any[]) => { calls.push(args); return of({ run: { ...quote, _id: 'run' }, replayed: false }); }, ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }, { provide: AuthService, useValue: { user: () => ({ id: actor }) } }] });
  const page = runInInjectionContext(injector, () => new SaasProduction()) as any; page.bakeryId = bakery; page.ngOnChanges(); await tick();
  t.after(() => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; });
  return { page, store, calls };
}
async function review(page: any) { page.form = { productId: product._id, batches: 2, note: 'Completed' }; await page.prepare(); assert.ok(page.reviewing()); }
test('production needs a server quote and explicit confirmation; later form edits cannot change the reviewed request', async t => {
  const { page, calls, store } = await setup(t); await review(page); assert.equal(calls.length, 0); assert.equal(store.values.size, 0);
  page.form.batches = 99; await page.confirm(); assert.equal(calls.length, 1); assert.equal(calls[0][1].batches, 2); assert.equal(calls[0][1].expectedProductVersion, 2);
  assert.equal(page.pending(), null); assert.equal(store.values.size, 0); assert.match(page.notice(), /18 pieces/);
});
test('uncertain production survives reload and retries the original key without adding a second run', async t => {
  const requests: any[] = []; let count = 0;
  const { page, store } = await setup(t, { recordProduction: (_id: string, input: unknown) => { requests.push(structuredClone(input)); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ run: quote, replayed: true }); } });
  await review(page); await page.confirm(); assert.ok(page.pending()); page.ngOnChanges(); await tick(); assert.deepEqual(loadPendingProduction(store, actor, bakery)?.input, requests[0]);
  page.form.batches = 5; await page.prepare(); assert.equal(page.reviewing(), null); page.reviewPending(); await page.confirm();
  assert.deepEqual(requests[1], requests[0]); assert.equal(page.pending(), null); assert.match(page.notice(), /existing entry confirmed/);
});
test('recovery write failure sends nothing and only definitive server rejection clears a pending entry', async t => {
  let sent = 0;
  const { page, store } = await setup(t, { recordProduction: () => { sent++; return throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Product changed', details: { code: 'PRODUCTION_REJECTED' } } })); } });
  await review(page); const set = store.setItem; store.setItem = () => {}; await page.confirm(); assert.equal(sent, 0);
  store.setItem = set; await page.confirm(); assert.equal(sent, 1); assert.equal(page.pending(), null); assert.equal(store.values.size, 0);
});
test('key conflicts and access loss retain production recovery', async t => {
  const { page, store } = await setup(t, { recordProduction: () => throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'PRODUCTION_KEY_CONFLICT' } } })) });
  await review(page); await page.confirm(); assert.ok(page.pending()); assert.equal(store.values.size, 1);
});
test('late production responses cannot alter the next bakery and retain original recovery', async t => {
  const response = new Subject<any>(); const { page, store } = await setup(t, { recordProduction: () => response });
  await review(page); const saving = page.confirm(); page.bakeryId = other; page.ngOnChanges(); await tick(); response.next({ run: quote, replayed: false }); await saving;
  assert.equal(page.pending(), null); assert.equal(page.notice(), ''); assert.ok(loadPendingProduction(store, actor, bakery)); assert.equal(loadPendingProduction(store, actor, other), null);
});
test('costs remain hidden by default and hide when page visibility changes', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'); const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true }); const { page } = await setup(t);
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  assert.equal(page.showCosts(), false); page.showCosts.set(true); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(page.showCosts(), false);
});
test('production recovery rejects replacement, corruption and silently failed cleanup', () => {
  const store = storage(), pending = { productName: 'Cake', producedPieces: 18, input: { productId: product._id, revisionId: product.recipeRevisionId, expectedProductVersion: 2, batches: 2, note: '', confirmed: true as const, idempotencyKey: randomUUID() } };
  savePendingProduction(store, actor, bakery, pending); assert.deepEqual(loadPendingProduction(store, actor, bakery), pending); assert.equal(loadPendingProduction(store, actor, other), null);
  assert.throws(() => savePendingProduction(store, actor, bakery, { ...pending, input: { ...pending.input, batches: 3 } }));
  assert.throws(() => clearPendingProduction(store, actor, bakery, randomUUID()));
  assert.throws(() => clearPendingProduction({ ...store, removeItem: () => {} }, actor, bakery, pending.input.idempotencyKey));
  clearPendingProduction(store, actor, bakery, pending.input.idempotencyKey); assert.equal(loadPendingProduction(store, actor, bakery), null);
  assert.throws(() => savePendingProduction(store, actor, bakery, { ...pending, input: { ...pending.input, batches: 1.5 } }));
  savePendingProduction(store, actor, bakery, pending); const key = [...store.values.keys()][0]; store.values.set(key, '{bad'); assert.throws(() => loadPendingProduction(store, actor, bakery));
});

test('late quotes cannot open a review in the newly selected bakery', async t => {
  const quoteResponse = new Subject<any>(); const { page } = await setup(t, { productionQuote: () => quoteResponse });
  page.form = { productId: product._id, batches: 2, note: '' }; const preparing = page.prepare(); page.bakeryId = other; page.ngOnChanges(); await tick();
  quoteResponse.next(quote); await preparing; assert.equal(page.reviewing(), null); assert.equal(page.quote(), null);
});
test('unmapped or untracked products and fractional batches cannot reach quote submission', async t => {
  let quotes = 0; const { page } = await setup(t, { productionQuote: () => { quotes++; return of(quote); } });
  page.form = { productId: product._id, batches: 1.5, note: '' }; await page.prepare(); assert.equal(quotes, 0);
  page.form.batches = 1; page.products.set([{ ...product, stockCount: null }]); await page.prepare(); assert.equal(quotes, 0);
  page.products.set([{ ...product, recipeRevisionId: null }]); await page.prepare(); assert.equal(quotes, 0);
});

test('the reviewed material inventory fingerprint is preserved in production submission and recovery', async t => {
  const fingerprint = 'a'.repeat(64); const { page, calls } = await setup(t, { productionQuote: () => of({ ...quote, inventoryFingerprint: fingerprint, materialUsage: [{ materialId: 'flour', before: '1000', after: '500', quantity: '500' }] }) });
  await review(page); assert.equal(page.reviewing().input.inventoryFingerprint, fingerprint); await page.confirm(); assert.equal(calls[0][1].inventoryFingerprint, fingerprint);
});
