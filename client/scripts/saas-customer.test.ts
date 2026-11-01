import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasCustomerService } from '../src/app/core/services/saas-customer.service';
import { SaasCustomer } from '../src/app/pages/saas-lab/saas-customer';
import { authInterceptor } from '../src/app/core/interceptors/auth.interceptor';
import { loadCustomerOrder, saveCustomerOrder, clearCustomerOrder } from '../src/app/core/utils/saas-customer-recovery';
const customer = { id: '100000000000000000000001', displayName: 'Alice', email: 'alice@example.test', emailVerified: false };
const product = { id: '200000000000000000000001', name: 'Cake', pricePaise: 19900, available: true };
const order = { version: 1, receivedPaise: 0, reservationStatus: 'active', _id: '300000000000000000000001', orderNumber: 'ORD-000001', totalPaise: 19900, paymentStatus: 'unpaid', fulfillment: 'pickup', items: [] };
const quote = { reservationMinutes: 30, items: [{ productId: product.id, name: 'Cake', quantity: 1, unitPricePaise: 19900, lineTotalPaise: 19900 }], totalPaise: 19900, paymentStatus: 'unpaid', fulfillment: 'pickup' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
async function setup(t: any, overrides: Record<string, unknown> = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = storage(); Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true });
  const calls: any[] = []; const api = { refreshReservations: () => of({ availabilityChanged: false, hasMore: false }), me: () => of(customer), orders: () => of({ orders: [], nextCursor: null }), login: () => of(customer), register: () => of(customer), logout: () => of({ success: true }), quote: () => of(quote),
    order: (...args: any[]) => { calls.push(args); return of({ order, replayed: false }); }, ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasCustomerService, useValue: api }] }); const page = runInInjectionContext(injector, () => new SaasCustomer()) as any;
  page.slug = 'bakery-a'; page.bakeryName = 'Bakery A'; page.orderingEnabled = true; page.products = [product]; page.ngOnChanges(); await tick();
  t.after(() => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; }); return { page, store, calls, injector };
}
async function review(page: any) { page.form = { items: [{ productId: product.id, quantity: 1 }], comment: 'Pickup please' }; await page.prepare(); assert.ok(page.reviewing()); }
test('customer checkout reviews server prices before reserving and freezes later cart changes', async t => {
  const { page, calls, store } = await setup(t); await review(page); assert.equal(calls.length, 0); assert.equal(store.values.size, 0); page.form.items[0].quantity = 8;
  await page.confirm(); assert.equal(calls[0][0], 'bakery-a'); assert.equal(calls[0][1], customer.id); assert.equal(calls[0][2].items[0].quantity, 1); assert.equal(calls[0][2].items[0].expectedUnitPricePaise, 19900); assert.equal(page.pending(), null); assert.equal(store.values.size, 0); assert.match(page.notice(), /due at pickup/);
});
test('customer retries after reload preserve the original key and account even when menu paging changes', async t => {
  const sent: any[] = []; let count = 0; const { page, store, injector } = await setup(t, { order: (...args: any[]) => { sent.push(structuredClone(args)); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ order, replayed: true }); } });
  await review(page); await page.confirm(); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id));
  page.products = [{ ...product, pricePaise: 29900 }]; page.ngOnChanges(); assert.ok(page.pending()); // same bakery is not an identity change
  page.ngOnDestroy(); const restored = runInInjectionContext(injector, () => new SaasCustomer()) as any; restored.slug = 'bakery-a'; restored.bakeryName = 'Bakery A'; restored.orderingEnabled = true; restored.products = [product]; restored.ngOnChanges(); await tick(); assert.ok(restored.pending()); restored.reviewPending(); await restored.confirm(); assert.deepEqual(sent[1], sent[0]); assert.equal(restored.pending(), null); assert.match(restored.notice(), /already saved/); restored.ngOnDestroy();
});
test('unretained recovery sends nothing and submission conflicts keep the pending pickup request', async t => {
  let sent = 0; const { page, store } = await setup(t, { order: () => { sent++; return throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'SALE_KEY_CONFLICT' } } })); } });
  await review(page); const set = store.setItem; store.setItem = () => {}; await page.confirm(); assert.equal(sent, 0); store.setItem = set;
  await page.confirm(); assert.equal(sent, 1); assert.ok(page.pending()); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id));
});
test('definitive order rejection clears recovery while account-session changes retain it and hide stale identity', async t => {
  let changed = false;
  const { page, store } = await setup(t, { order: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Changed', details: { code: changed ? 'CUSTOMER_SESSION_CHANGED' : 'SALE_REJECTED' } } })) });
  await review(page); await page.confirm(); assert.equal(page.pending(), null); assert.equal(store.values.size, 0);
  changed = true; await review(page); await page.confirm(); assert.equal(page.customer(), null); assert.deepEqual(page.orders(), []); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id));
});
test('passwords are cleared from form state before sign-in finishes and are never placed in order storage', async t => {
  const response = new Subject<any>(); const sent: any[] = []; const { page, store } = await setup(t, { me: () => throwError(() => new HttpErrorResponse({ status: 401 })), login: (...args: any[]) => { sent.push(structuredClone(args)); return response; } });
  page.credentials = { email: customer.email, password: 'Local test password!42', displayName: '' }; const signing = page.signIn(); assert.equal(page.credentials.password, ''); assert.equal(store.values.size, 0); assert.equal(sent[0][1].password, 'Local test password!42');
  response.next(customer); await signing; assert.equal(page.customer().id, customer.id); assert.equal(page.credentials.password, '');
});
test('late customer save responses cannot replace a different bakery or clear earlier recovery', async t => {
  const response = new Subject<any>(); const { page, store } = await setup(t, { order: () => response }); await review(page); const saving = page.confirm();
  page.slug = 'bakery-b'; page.ngOnChanges(); await tick(); response.next({ order, replayed: false }); await saving;
  assert.equal(page.notice(), ''); assert.equal(page.pending(), null); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id)); assert.equal(loadCustomerOrder(store, 'bakery-b', customer.id), null);
});
test('pickup cannot be reviewed while paused, but a previously saved request can still be retried', async t => {
  const { page, calls } = await setup(t); await review(page); const reviewed = page.reviewing(); page.cancel(); page.orderingEnabled = false; await page.prepare(); assert.equal(page.reviewing(), null);
  page.pending.set(reviewed); page.reviewPending(); await page.confirm(); assert.equal(calls.length, 1);
});
test('customer recovery validates tenant identity, exact payload and safe cleanup', () => {
  const store = storage(), input = { items: [{ productId: product.id, quantity: 1, expectedUnitPricePaise: 19900 }], comment: '', confirmed: true as const, idempotencyKey: randomUUID() };
  saveCustomerOrder(store, 'bakery-a', customer.id, input); assert.deepEqual(loadCustomerOrder(store, 'bakery-a', customer.id), input); assert.equal(loadCustomerOrder(store, 'bakery-b', customer.id), null); assert.equal(loadCustomerOrder(store, 'bakery-a', '400000000000000000000001'), null);
  assert.throws(() => saveCustomerOrder(store, 'bakery-a', customer.id, { ...input, comment: 'Changed' })); assert.throws(() => clearCustomerOrder(store, 'bakery-a', customer.id, randomUUID()));
  assert.throws(() => clearCustomerOrder({ ...store, removeItem: () => {} }, 'bakery-a', customer.id, input.idempotencyKey)); clearCustomerOrder(store, 'bakery-a', customer.id, input.idempotencyKey);
  assert.throws(() => saveCustomerOrder(store, 'bakery-a', customer.id, { ...input, items: [{ ...input.items[0], quantity: 0 }] }));
  saveCustomerOrder(store, 'bakery-a', customer.id, input); store.values.set([...store.values.keys()][0], '{bad'); assert.throws(() => loadCustomerOrder(store, 'bakery-a', customer.id));
});
test('legacy bearer tokens are not attached to customer requests but remain available to staff requests', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); let reads = 0;
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => { reads++; return 'synthetic-staff-token'; } }, configurable: true });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete (globalThis as any).localStorage; });
  let captured: any; const next = (request: any) => { captured = request; return of(new HttpResponse({ status: 200 })); };
  authInterceptor(new HttpRequest('GET', '/api/saas/storefront/bakery-a/customer/orders'), next).subscribe(); assert.equal(captured.headers.has('Authorization'), false); assert.equal(reads, 0); assert.equal(captured.withCredentials, true);
  authInterceptor(new HttpRequest('GET', '/api/saas/bakeries'), next).subscribe(); assert.equal(captured.headers.get('Authorization'), 'Bearer synthetic-staff-token'); assert.equal(reads, 1);
});

test('confirming a previously paid order does not ask the customer to pay again', async t => {
  const { page } = await setup(t, { order: () => of({ order: { ...order, paymentStatus: 'paid' }, replayed: true }) });
  await review(page); await page.confirm(); assert.match(page.notice(), /Payment is recorded/); assert.doesNotMatch(page.notice(), /due at pickup/);
});

test('checkout refreshes due reservations before quoting and freezes the reviewed hold duration', async t => {
  const sequence: string[] = []; const { page, calls } = await setup(t, {
    refreshReservations: () => { sequence.push('release'); return of({ availabilityChanged: true, hasMore: true }); },
    quote: () => { sequence.push('quote'); return of({ ...quote, reservationMinutes: 45 }); },
  });
  let menuRefreshes = 0; page.availabilityChanged.subscribe(() => menuRefreshes++); await review(page);
  assert.deepEqual(sequence.slice(-2), ['release', 'quote']); assert.equal(page.moreExpired(), true); assert.equal(menuRefreshes, 1);
  await page.confirm(); assert.equal(calls[0][2].expectedReservationMinutes, 45);
});
test('reservation refresh failure prevents checkout and does not discard pending recovery', async t => {
  let quotes = 0; const { page } = await setup(t, { refreshReservations: () => throwError(() => new HttpErrorResponse({ status: 503 })), quote: () => { quotes++; return of(quote); } });
  page.form.items = [{ productId: product.id, quantity: 1 }]; await page.prepare(); assert.equal(quotes, 0); assert.equal(page.reviewing(), null); assert.ok(page.error());
});
test('pickup cancellation freezes the reviewed version and retains its dialog on uncertain responses', async t => {
  const sent: any[] = []; let attempt = 0;
  const { page } = await setup(t, { cancelOrder: (...args: any[]) => { sent.push(args); return ++attempt === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ alreadyClosed: true, order: { reservationStatus: 'cancelled' } }); } });
  const row = { ...order, version: 3 }; page.reviewCancel(row); row.version = 9; page.cancelReason = 'No longer needed'; await page.confirmCancel();
  assert.ok(page.cancelling()); assert.equal(sent[0][3], 3); await page.confirmCancel(); assert.equal(page.cancelling(), null); assert.deepEqual(sent[1], sent[0]); assert.match(page.notice(), /cancelled/);
  assert.equal(page.canCancel({ ...order, receivedPaise: 1 }), false); assert.equal(page.canCancel({ ...order, reservationConfirmedAt: '2026-10-31' }), false); assert.equal(page.canCancel({ ...order, reservationStatus: 'expired' }), false);
});
test('a closed order replay never asks for pickup payment again', async t => {
  const { page } = await setup(t, { order: () => of({ order: { ...order, reservationStatus: 'expired' }, replayed: true }) }); await review(page); await page.confirm(); assert.match(page.notice(), /closed; no payment is due/); assert.doesNotMatch(page.notice(), /due at pickup/);
});
test('reservation terms in recovery are bounded while old saved payloads remain readable', () => {
  const input = { items: [{ productId: product.id, quantity: 1, expectedUnitPricePaise: 19900 }], comment: '', confirmed: true as const, idempotencyKey: randomUUID() };
  const store = storage(); saveCustomerOrder(store, 'bakery-a', customer.id, { ...input, expectedReservationMinutes: 30 }); assert.equal(loadCustomerOrder(store, 'bakery-a', customer.id)?.expectedReservationMinutes, 30);
  for (const value of [0, 4, 1441, 30.1]) assert.throws(() => saveCustomerOrder(storage(), 'bakery-a', customer.id, { ...input, expectedReservationMinutes: value }));
});

test('account security updates retain durable pickup recovery while clearing an expired identity', async t => {
 let expired = false; const { page, store } = await setup(t, { me: () => expired ? throwError(() => new HttpErrorResponse({ status: 401 })) : of(customer), order: () => throwError(() => new HttpErrorResponse({ status: 0 })) });
 await review(page); await page.confirm(); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id)); expired = true; await page.securityChanged('Password changed. Sign in again'); assert.equal(page.customer(), null); assert.deepEqual(page.orders(), []); assert.ok(loadCustomerOrder(store, 'bakery-a', customer.id)); assert.match(page.notice(), /Sign in again/);
});
test('an account security request blocks a simultaneous checkout without resetting the cart', async t => {
 let quotes = 0; const { page } = await setup(t, { quote: () => { quotes++; return of(quote); } }); page.form.items = [{ productId: product.id, quantity: 1 }]; page.accountBusy.set(true); await page.prepare(); assert.equal(quotes, 0); assert.equal(page.form.items[0].productId, product.id); page.accountBusy.set(false); await page.prepare(); assert.equal(quotes, 1);
});
