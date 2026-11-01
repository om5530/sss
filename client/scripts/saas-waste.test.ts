import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../src/app/core/services/auth.service';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasWaste } from '../src/app/pages/saas-lab/saas-waste';
import { loadPendingWaste, savePendingWaste, clearPendingWaste } from '../src/app/core/utils/saas-waste-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const product = { _id: '400000000000000000000001', name: 'Cake', stockCount: 5, version: 2, archived: true };
const event = { _id: '500000000000000000000001', name: 'Event', status: 'closed' };
const quote = { productId: product._id, productName: 'Cake', quantity: 1, stockBefore: 5, stockAfter: 4, estimatedCostPaise: '1000', eventId: event._id, eventName: 'Event', reason: 'Spoiled' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
async function setup(t: any, overrides: Record<string, unknown> = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = storage(); Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true });
  const calls: any[] = []; const api = { products: () => of({ products: [product], nextCursor: null }), events: () => of({ events: [event], nextCursor: null }), wasteEntries: () => of({ entries: [], nextCursor: null }), wasteQuote: () => of(quote),
    recordWaste: (...args: any[]) => { calls.push(args); return of({ entry: quote, replayed: false }); }, ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }, { provide: AuthService, useValue: { user: () => ({ id: actor }) } }] });
  const page = runInInjectionContext(injector, () => new SaasWaste()) as any; page.bakeryId = bakery; page.ngOnChanges(); await tick();
  t.after(() => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; }); return { page, store, calls };
}
async function review(page: any) { page.form = { productId: product._id, eventId: event._id, quantity: 1, reason: 'Spoiled' }; await page.prepare(); assert.ok(page.reviewing()); }
test('wastage requires confirmation and freezes quantity and selected event before any write', async t => {
  const { page, calls, store } = await setup(t); await review(page); assert.equal(calls.length, 0); assert.equal(store.values.size, 0); page.form.quantity = 4; page.form.eventId = '';
  await page.confirm(); assert.equal(calls[0][1].quantity, 1); assert.equal(calls[0][1].eventId, event._id); assert.equal(page.pending(), null); assert.match(page.notice(), /stock reduced/);
});
test('lost wastage responses survive reload and retry the same key without another stock deduction', async t => {
  let count = 0; const requests: any[] = []; const { page, store } = await setup(t, { recordWaste: (_id: string, input: unknown) => { requests.push(structuredClone(input)); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ entry: quote, replayed: true }); } });
  await review(page); await page.confirm(); page.ngOnChanges(); await tick(); assert.deepEqual(loadPendingWaste(store, actor, bakery)?.input, requests[0]);
  await page.prepare(); assert.equal(page.reviewing(), null); page.reviewPending(); await page.confirm(); assert.deepEqual(requests[1], requests[0]); assert.equal(page.pending(), null);
});
test('wastage recovery failures send no write and key conflicts preserve the pending record', async t => {
  let sent = 0; const { page, store } = await setup(t, { recordWaste: () => { sent++; return throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'WASTE_KEY_CONFLICT' } } })); } });
  await review(page); const set = store.setItem; store.setItem = () => {}; await page.confirm(); assert.equal(sent, 0); store.setItem = set; await page.confirm(); assert.equal(sent, 1); assert.ok(page.pending());
});
test('only a definitive wastage rejection clears the durable retry record', async t => {
  const { page, store } = await setup(t, { recordWaste: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Stock changed', details: { code: 'WASTE_REJECTED' } } })) });
  await review(page); await page.confirm(); assert.equal(page.pending(), null); assert.equal(store.values.size, 0); assert.match(page.error(), /Stock changed/);
});
test('unknown waste costs remain unknown and fractional or untracked quantities cannot be quoted', async t => {
  let quotes = 0; const { page } = await setup(t, { wasteQuote: () => { quotes++; return of({ ...quote, estimatedCostPaise: null }); } });
  await review(page); assert.equal(page.quote().estimatedCostPaise, null); page.cancel(); page.form.quantity = 0.5; await page.prepare(); assert.equal(quotes, 1);
  page.form.quantity = 1; page.products.set([{ ...product, stockCount: null }]); await page.prepare(); assert.equal(quotes, 1);
});
test('late wastage save responses cannot alter another bakery or clear the original recovery record', async t => {
  const response = new Subject<any>(); const { page, store } = await setup(t, { recordWaste: () => response }); await review(page); const saving = page.confirm();
  page.bakeryId = other; page.ngOnChanges(); await tick(); response.next({ entry: quote, replayed: false }); await saving; assert.equal(page.pending(), null); assert.equal(page.notice(), ''); assert.ok(loadPendingWaste(store, actor, bakery));
});
test('waste costs remain hidden by default and hide when visibility changes', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'), document = Object.assign(new EventTarget(), { hidden: false }); Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const { page } = await setup(t); t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  assert.equal(page.showCosts(), false); page.showCosts.set(true); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(page.showCosts(), false);
});
test('wastage recovery validates scoped identity, positive quantities, unchanged keys and corruption', () => {
  const store = storage(), pending = { productName: 'Cake', eventName: 'Event', input: { productId: product._id, eventId: event._id, quantity: 1, expectedProductVersion: 2, reason: 'Spoiled', confirmed: true as const, idempotencyKey: randomUUID() } };
  savePendingWaste(store, actor, bakery, pending); assert.deepEqual(loadPendingWaste(store, actor, bakery), pending); assert.equal(loadPendingWaste(store, actor, other), null); assert.equal(loadPendingWaste(store, other, bakery), null);
  assert.throws(() => savePendingWaste(store, actor, bakery, { ...pending, input: { ...pending.input, quantity: 2 } })); assert.throws(() => clearPendingWaste(store, actor, bakery, randomUUID()));
  assert.throws(() => clearPendingWaste({ ...store, removeItem: () => {} }, actor, bakery, pending.input.idempotencyKey)); clearPendingWaste(store, actor, bakery, pending.input.idempotencyKey);
  assert.throws(() => savePendingWaste(store, actor, bakery, { ...pending, input: { ...pending.input, quantity: 0 } })); savePendingWaste(store, actor, bakery, pending); store.values.set([...store.values.keys()][0], '{bad'); assert.throws(() => loadPendingWaste(store, actor, bakery));
});
