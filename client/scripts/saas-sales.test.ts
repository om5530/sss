import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../src/app/core/services/auth.service';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasSales } from '../src/app/pages/saas-lab/saas-sales';
import { loadPendingSale } from '../src/app/core/utils/saas-sale-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001', productId = '400000000000000000000001';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const product = { _id: productId, name: 'Cake', pricePaise: 19900, available: true, stockCount: 10 };
const sale = { _id: '500000000000000000000001', orderNumber: 'ORD-000001', totalPaise: 19900, version: 1, paymentStatus: 'paid' };
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
async function setup(t: any, overrides: Record<string, unknown> = {}, sharedStorage = storage()) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: sharedStorage, configurable: true });
  const calls: any[] = [];
  const api = { products: () => of({ products: [product], nextCursor: null }), events: () => of({ events: [], nextCursor: null }), orders: () => of({ orders: [], nextCursor: null }),
    createSale: (...args: any[]) => { calls.push(args); return of({ order: sale, replayed: false }); }, eventReport: () => of({ paidSalesPaise: '19900' }), ...overrides };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }, { provide: AuthService, useValue: { user: () => ({ id: actor }) } }] });
  const page = runInInjectionContext(injector, () => new SaasSales()) as any; page.bakeryId = bakery; page.role = 'owner'; page.ngOnChanges(); await tick();
  const cleanup = () => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; };
  t.after(cleanup); return { page, api, calls, storage: sharedStorage };
}
function review(page: any) { page.form.items = [{ productId, quantity: 1 }]; page.reviewSale(); assert.ok(page.reviewing()); }

test('counter review freezes the quoted price and requires confirmation before any request', async t => {
  const { page, calls, storage } = await setup(t); review(page);
  assert.equal(calls.length, 0); assert.equal(storage.values.size, 0);
  assert.equal(page.reviewing().items[0].expectedUnitPricePaise, 19900);
  page.form.items[0].quantity = 8;
  await page.confirmSale(); assert.equal(calls.length, 1); assert.equal(calls[0][1].items[0].quantity, 1);
  assert.equal(page.pending(), null); assert.equal(storage.values.size, 0); assert.match(page.notice(), /ORD-000001/);
});

test('an interrupted save keeps the exact durable request and retry confirms rather than creating another key', async t => {
  const requests: any[] = []; let count = 0;
  const { page, storage } = await setup(t, { createSale: (_id: string, input: unknown) => { requests.push(structuredClone(input)); return ++count === 1
    ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ order: sale, replayed: true }); } });
  review(page); await page.confirmSale();
  assert.ok(page.pending()); assert.deepEqual(loadPendingSale(storage, actor, bakery), requests[0]);
  page.ngOnChanges(); await tick(); assert.deepEqual(page.pending(), requests[0]);
  page.cancelDialog(); page.products.set([{ ...product, pricePaise: 29900 }]); page.form.comment = 'Changed after interruption';
  page.reviewSale(); await page.confirmSale();
  assert.deepEqual(requests[1], requests[0]); assert.equal(page.pending(), null); assert.match(page.notice(), /existing submission confirmed/);
});

test('storage failure sends no sale and a submission-key conflict retains recovery state', async t => {
  const { page, calls, storage } = await setup(t); review(page);
  const set = storage.setItem; storage.setItem = () => { throw new Error('Quota'); }; await page.confirmSale();
  assert.equal(calls.length, 0); assert.equal(page.pending(), null); storage.setItem = set;
  (page as any).api.createSale = () => throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code: 'SALE_KEY_CONFLICT' }, message: 'Review existing submission' } }));
  await page.confirmSale(); assert.ok(page.pending()); assert.ok(loadPendingSale(storage, actor, bakery));
});

test('a definitive stale-price rejection clears recovery but retains editable form data', async t => {
  const { page, storage } = await setup(t, { createSale: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Product price changed', details: { code: 'SALE_REJECTED' } } })) });
  review(page); await page.confirmSale(); assert.equal(page.pending(), null); assert.equal(storage.values.size, 0);
  assert.equal(page.form.items[0].productId, productId); assert.equal(page.reviewing(), null); assert.match(page.error(), /price changed/);
});

test('financial reports start hidden and delayed responses cannot reveal them after hide, event change or staff access', async t => {
  const reports = new Subject<any>(); let calls = 0;
  const { page } = await setup(t, { eventReport: () => { calls++; return reports; } });
  assert.equal(calls, 0); assert.equal(page.finances(), null); page.eventId = '600000000000000000000001';
  const loading = page.toggleFinances(); page.hideFinances(); reports.next({ paidSalesPaise: '19900' }); await loading;
  assert.equal(page.finances(), null); page.role = 'staff'; await page.toggleFinances(); assert.equal(calls, 1);
  page.role = 'owner'; page.finances.set({ paidSalesPaise: '19900' }); await page.eventChanged(); assert.equal(page.finances(), null);
});

test('changing bakery ignores a late sale response and preserves only the original bakery recovery key', async t => {
  const response = new Subject<any>(); const { page, storage } = await setup(t, { createSale: () => response });
  review(page); const saving = page.confirmSale(); assert.ok(loadPendingSale(storage, actor, bakery));
  page.bakeryId = other; page.ngOnChanges(); await tick(); response.next({ order: sale, replayed: false }); await saving;
  assert.equal(page.pending(), null); assert.equal(page.notice(), ''); assert.deepEqual(page.orders(), []);
  assert.ok(loadPendingSale(storage, actor, bakery)); assert.equal(loadPendingSale(storage, actor, other), null);
});

test('page visibility changes hide event finances immediately', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const { page } = await setup(t);
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  page.finances.set({ paidSalesPaise: '19900' }); document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.finances(), null); document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.finances(), null);
});

test('access loss cannot discard an uncertain sale because it does not prove the earlier request failed', async t => {
  const { page, storage } = await setup(t, { createSale: () => throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Bakery not found' } })) });
  review(page); await page.confirmSale();
  assert.ok(page.pending()); assert.ok(loadPendingSale(storage, actor, bakery));
});

const balanceOrder = { ...sale, items: [], subtotalPaise: 19900, discountPaise: 1000, totalPaise: 18900, receivedPaise: 19900, duePaise: 0, refundDuePaise: 1000, comment: 'Original comment', paymentMethod: 'cash' };
test('owners correct a reviewed discount while staff and invalid amounts cannot submit', async t => {
  const sent: any[] = [];
  const { page } = await setup(t, { correctDiscount: (...args: any[]) => { sent.push(args); return of({ ...balanceOrder, version: 2 }); } });
  page.role = 'staff'; page.openAdjustment(balanceOrder, 'discount'); assert.equal(page.adjusting(), null);
  page.role = 'owner'; page.openAdjustment(balanceOrder, 'discount');
  page.adjustmentForm.reason = 'Reviewed discount'; page.adjustmentForm.discount = '199.01'; await page.confirmAdjustment(); assert.equal(sent.length, 0);
  page.adjustmentForm.discount = '20.001'; await page.confirmAdjustment(); assert.equal(sent.length, 0);
  page.adjustmentForm.discount = '20.00'; await page.confirmAdjustment();
  assert.equal(sent.length, 1); assert.equal(sent[0][0], bakery); assert.equal(sent[0][1], balanceOrder._id);
  assert.deepEqual(sent[0][2], { expectedVersion: 1, discountPaise: 2000, comment: 'Original comment', reason: 'Reviewed discount', confirmed: true });
  assert.equal(page.adjusting(), null); assert.match(page.notice(), /preserved/);
});

test('uncertain refund retries use exactly the original reviewed key and details', async t => {
  const sent: any[] = []; let attempt = 0;
  const { page } = await setup(t, { recordRefund: (...args: any[]) => { sent.push(structuredClone(args)); return ++attempt === 1
    ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ order: balanceOrder, replayed: true }); } });
  page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned'; page.adjustmentForm.method = 'upi';
  await page.confirmAdjustment(); assert.ok(page.refundAttempt); assert.equal(page.adjusting().mode, 'refund');
  page.adjustmentForm.reason = 'Edited after interruption'; page.adjustmentForm.method = 'cash'; await page.confirmAdjustment();
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(sent[0][2].expectedRefundPaise, 1000); assert.equal(sent[0][2].paymentMethod, 'upi');
  assert.equal(page.refundAttempt, null); assert.equal(page.adjusting(), null);
});

test('closed history and changed bakery ignore delayed private history responses', async t => {
  const payments = new Subject<any>(), changes = new Subject<any>();
  const { page } = await setup(t, { paymentHistory: () => payments, correctionHistory: () => changes });
  page.openAdjustment(balanceOrder, 'history'); assert.equal(page.historyLoading(), true);
  page.cancelDialog(); payments.next({ entries: [{ kind: 'refund', amountPaise: 1000 }], nextCursor: null }); changes.next({ entries: [], nextCursor: null }); await tick();
  assert.equal(page.adjusting(), null); assert.deepEqual(page.payments(), []); assert.equal(page.historyLoading(), false);
  page.openAdjustment(balanceOrder, 'history'); page.bakeryId = other; page.ngOnChanges();
  payments.next({ entries: [{ kind: 'refund', amountPaise: 1000 }], nextCursor: null }); changes.next({ entries: [], nextCursor: null }); await tick();
  assert.deepEqual(page.payments(), []); assert.equal(page.adjusting(), null);
});

test('late correction responses cannot replace the newly selected bakery', async t => {
  const response = new Subject<any>(); const { page } = await setup(t, { correctDiscount: () => response });
  page.openAdjustment(balanceOrder, 'discount'); page.adjustmentForm.reason = 'Correction'; const saving = page.confirmAdjustment();
  page.bakeryId = other; page.ngOnChanges(); await tick(); response.next(balanceOrder); await saving;
  assert.equal(page.notice(), ''); assert.equal(page.adjusting(), null); assert.deepEqual(page.orders(), []);
});

test('backgrounding clears private history without discarding an uncertain refund record', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const { page } = await setup(t, { paymentHistory: () => of({ entries: [{ kind: 'receipt', amountPaise: 19900 }], nextCursor: null }), correctionHistory: () => of({ entries: [], nextCursor: null }),
    recordRefund: () => throwError(() => new HttpErrorResponse({ status: 0 })) });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  page.openAdjustment(balanceOrder, 'history'); await tick(); assert.equal(page.payments().length, 1);
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(page.adjusting(), null); assert.deepEqual(page.payments(), []);
  document.hidden = false; page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned'; await page.confirmAdjustment();
  const key = page.refundAttempt.idempotencyKey; document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.refundAttempt.idempotencyKey, key); assert.equal(page.adjusting().mode, 'refund');
});

test('a refund interrupted by reload restores the original record and prevents a new refund key', async t => {
  const requests: any[] = []; let count = 0;
  const { page, storage } = await setup(t, { recordRefund: (_bakery: string, _order: string, input: unknown) => {
    requests.push(structuredClone(input)); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ order: balanceOrder, replayed: true });
  } });
  page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned'; await page.confirmAdjustment();
  assert.ok(page.pendingRefund()); page.ngOnChanges(); await tick(); assert.equal(page.refundAttempt, null); assert.deepEqual(page.pendingRefund().request, requests[0]);
  page.openAdjustment(balanceOrder, 'refund'); assert.equal(page.adjusting(), null);
  await page.retryRefund(); assert.deepEqual(requests[1], requests[0]); assert.equal(page.pendingRefund(), null); assert.equal(storage.values.size, 0);
});
test('refund storage failure sends no request and access loss retains pending recovery', async t => {
  const requests: any[] = [];
  const { page, storage } = await setup(t, { recordRefund: (...args: any[]) => { requests.push(args); return throwError(() => new HttpErrorResponse({ status: 403 })); } });
  page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned';
  const set = storage.setItem; storage.setItem = () => { throw new Error('Quota'); }; await page.confirmAdjustment(); assert.equal(requests.length, 0);
  storage.setItem = set; await page.confirmAdjustment(); assert.equal(requests.length, 1); assert.ok(page.pendingRefund()); assert.equal(storage.values.size, 1);
});
test('only a definitive refund rejection clears a pending retry record', async t => {
  const { page, storage } = await setup(t, { recordRefund: () => throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Refund balance changed', details: { code: 'REFUND_REJECTED' } } })) });
  page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned'; await page.confirmAdjustment();
  assert.equal(page.pendingRefund(), null); assert.equal(storage.values.size, 0); assert.match(page.error(), /balance changed/);
});

test('late refund responses preserve recovery only for the original bakery', async t => {
  const response = new Subject<any>(); const { page, storage } = await setup(t, { recordRefund: () => response });
  page.openAdjustment(balanceOrder, 'refund'); page.adjustmentForm.reason = 'Already returned'; const saving = page.confirmAdjustment();
  assert.ok(page.pendingRefund()); page.bakeryId = other; page.ngOnChanges(); await tick(); response.next({ order: balanceOrder, replayed: false }); await saving;
  assert.equal(page.pendingRefund(), null); assert.equal(page.notice(), ''); assert.equal(storage.values.size, 1);
  page.bakeryId = bakery; page.ngOnChanges(); await tick(); assert.ok(page.pendingRefund());
});

test('owner pickup cancellation reviews one version and refreshes stock after closure', async t => {
  const sent: any[] = []; const { page } = await setup(t, { cancelPickup: (...args: any[]) => { sent.push(args); return of({ success: true }); } });
  const order = { ...sale, source: 'storefront', paymentStatus: 'unpaid', receivedPaise: 0, reservationStatus: 'active' };
  page.reviewPickupCancellation(order); order.version = 99; page.pickupCancelReason = 'Customer request'; await page.confirmPickupClosure(); assert.equal(sent[0][2], 1); assert.equal(page.cancellingPickup(), null);
  assert.equal(page.canCancelPickup({ ...order, reservationConfirmedAt: '2026-10-31' }), false); assert.equal(page.canCancelPickup({ ...order, reservationStatus: 'cancelled' }), false);
  page.role = 'staff'; page.expiringPickups.set(true); await page.confirmPickupClosure(); assert.equal(sent.length, 1);
});
test('expiry release reports bounded remaining work and stock reconciliation exceptions', async t => {
  const { page } = await setup(t, { expireReservations: () => of({ expiredCount: 20, reconciliationCount: 2, hasMore: true }) });
  page.expiringPickups.set(true); await page.confirmPickupClosure(); assert.match(page.notice(), /20/); assert.match(page.notice(), /2 need a stock recount/); assert.match(page.notice(), /More are waiting/); assert.equal(page.expiringPickups(), false);
});

test('pickup review keeps preparation separate from payment and freezes the reviewed order', async t => {
  const calls: any[] = []; const { page } = await setup(t, { updatePickup: (...args: any[]) => { calls.push(args); return of({ order: { _id: sale._id, version: 2, pickupStatus: 'ready' }, alreadyUpdated: false }); } });
  const order = { ...sale, source: 'storefront', pickupStatus: 'pending', paymentStatus: 'unpaid', receivedPaise: 0, duePaise: 19900, items: [{ productId, name: 'Cake', quantity: 1 }] };
  page.role = 'staff'; page.reviewPickup(order, 'collected'); assert.equal(page.pickupUpdate(), null);
  page.reviewPickup(order, 'ready'); order.version = 9; await page.confirmPickupUpdate(); assert.equal(calls[0][2], 1); assert.equal(calls[0][3], 'ready'); assert.equal(page.pickupUpdate(), null); assert.match(page.notice(), /Ready for pickup/);
  page.reviewPickup({ ...order, pickupStatus: 'ready' }, 'collected'); assert.equal(page.pickupUpdate(), null);
  page.reviewPickup({ ...order, pickupStatus: 'ready', paymentStatus: 'paid', duePaise: 0 }, 'collected'); assert.equal(page.pickupUpdate().status, 'collected'); page.cancelDialog(); assert.equal(page.pickupUpdate(), null);
  page.reviewPickup({ ...order, reservationStatus: 'cancelled' }, 'ready'); assert.equal(page.pickupUpdate(), null);
});
test('uncertain pickup update retains the same milestone and version for an idempotent retry', async t => {
  const calls: any[] = []; let attempt = 0; const { page } = await setup(t, { updatePickup: (...args: any[]) => { calls.push(args); return ++attempt === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of({ order: { _id: sale._id, pickupStatus: 'collected', version: 4 }, alreadyUpdated: true }); } });
  page.reviewPickup({ ...sale, source: 'storefront', pickupStatus: 'ready', duePaise: 0 }, 'collected'); await page.confirmPickupUpdate(); assert.ok(page.pickupUpdate()); await page.confirmPickupUpdate(); assert.deepEqual(calls[1], calls[0]); assert.equal(page.pickupUpdate(), null); assert.match(page.notice(), /Collected.*Earlier update confirmed/);
});
test('a delayed pickup update cannot replace the next bakery workspace', async t => {
  const response = new Subject<any>(); const { page } = await setup(t, { updatePickup: () => response });
  page.reviewPickup({ ...sale, source: 'storefront', pickupStatus: 'pending', duePaise: 0 }, 'ready'); const pending = page.confirmPickupUpdate();
  page.bakeryId = other; page.ngOnChanges(); await tick(); response.next({ order: { _id: sale._id, pickupStatus: 'ready', version: 2 }, alreadyUpdated: false }); await pending;
  assert.equal(page.pickupUpdate(), null); assert.equal(page.notice(), ''); assert.deepEqual(page.orders(), []);
});
