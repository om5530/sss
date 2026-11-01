import { SaasAccountState } from '../src/app/core/services/saas-account-state.service';
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { AuthService } from '../src/app/core/services/auth.service';
import { SaasBilling } from '../src/app/pages/saas-lab/saas-billing';
import { loadBilling, saveBilling, clearBilling, billingLink } from '../src/app/core/utils/saas-billing-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const checkout = { _id: '400000000000000000000001', planId: 'starter', amountPaise: 49900, version: 2, phase: 'ready', providerStatus: 'created', hostedUrl: 'https://rzp.io/rzp/test' };
const plan = { planId: 'starter', amountPaise: 49900, currency: 'INR', period: 'monthly', cycles: 12 };
function storage() { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } }; }
function setup(t: any, overrides: Record<string, unknown> = {}, workspaceId?: string) {
 const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), store = storage(); Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true }); const calls: any[] = [];
 const api = { billing: () => of({ configured: true, mode: 'test', checkout: null }), billingPlans: () => of({ plans: [plan] }), startBilling: (...args: any[]) => { calls.push(args); return of({ checkout, replayed: false }); }, billingInvoices: () => of({ invoices: [], nextCursor: null }), ...overrides };
 const state = new SaasAccountState(); if (workspaceId) state.account.set({ id: workspaceId, displayName: 'Workspace owner', email: 'owner@example.test', emailVerified: false });
 const injector = Injector.create({ providers: [{ provide: SaasAccountState, useValue: state }, { provide: SaasService, useValue: api }, { provide: AuthService, useValue: { user: () => ({ id: actor }) } }] }); const page = runInInjectionContext(injector, () => new SaasBilling()) as any; page.bakeryId = bakery; page.ngOnChanges();
 t.after(() => { page.ngOnDestroy(); injector.destroy(); if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete (globalThis as any).sessionStorage; }); return { page, calls, store };
}
test('test billing requires explicit review and durable recovery before checkout creation', async t => {
 const { page, calls, store } = setup(t); assert.equal(page.opened(), false); await page.load(); page.prepare(plan); assert.equal(calls.length, 0); await page.confirm(); assert.equal(calls.length, 1); assert.equal(calls[0][1].expectedAmountPaise, 49900); assert.equal(store.values.size, 0);
});
test('lost checkout responses preserve the exact key, show the error and block a different attempt', async t => {
 const sent: any[] = []; let count = 0; const { page, store } = setup(t, { startBilling: (...args: any[]) => { sent.push(args); return ++count === 1 ? throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'Uncertain creation', details: { code: 'BILLING_CHECKOUT_UNCERTAIN' } } })) : of({ checkout, replayed: true }); } });
 await page.load(); page.prepare(plan); await page.confirm(); const pending = loadBilling(store, actor, bakery); assert.ok(pending); assert.match(page.error(), /Uncertain creation/); page.prepare({ ...plan, planId: 'growth' }); assert.equal(page.pending().planId, 'starter'); page.reviewPending(); await page.confirm(); assert.deepEqual(sent[1], sent[0]); assert.equal(page.pending(), null);
});
test('silently discarded recovery prevents sending any billing request', async t => {
 const { page, calls, store } = setup(t); await page.load(); page.prepare(plan); store.setItem = () => {}; await page.confirm(); assert.equal(calls.length, 0); assert.match(page.error(), /No request was sent/);
});
test('definitive price rejection clears recovery but key conflicts retain it', async t => {
 let code = 'BILLING_REJECTED'; const { page, store } = setup(t, { startBilling: () => throwError(() => new HttpErrorResponse({ status: 409, error: { details: { code } } })) }); await page.load(); page.prepare(plan); await page.confirm(); assert.equal(store.values.size, 0); code = 'BILLING_KEY_CONFLICT'; page.prepare(plan); await page.confirm(); assert.ok(loadBilling(store, actor, bakery));
});
test('cancellation freezes the reviewed version and stale responses cannot replace another bakery', async t => {
 const sent: any[] = []; const response = new Subject<any>(); const { page } = setup(t, { billing: () => of({ configured: true, mode: 'test', checkout }), cancelBilling: (...args: any[]) => { sent.push(args); return response; } }); await page.load(); page.reviewCancel(); page.checkout.set({ ...checkout, version: 99 }); const cancel = page.confirm(); assert.equal(sent[0][1], 2); page.bakeryId = other; page.ngOnChanges(); response.next({ checkout }); await cancel; assert.equal(page.checkout(), null); assert.equal(page.notice(), '');
});
test('billing recovery validates scope and payload and checkout URLs are strictly constrained', () => {
 const store = storage(), input = { planId: 'starter' as const, expectedAmountPaise: 49900, idempotencyKey: randomUUID() }; saveBilling(store, actor, bakery, input); assert.deepEqual(loadBilling(store, actor, bakery), input); assert.equal(loadBilling(store, actor, other), null); assert.throws(() => clearBilling(store, actor, bakery, randomUUID())); assert.throws(() => saveBilling(store, actor, bakery, { ...input, expectedAmountPaise: 1 })); clearBilling(store, actor, bakery, input.idempotencyKey); assert.equal(loadBilling(store, actor, bakery), null);
 for (const url of ['javascript:alert(1)', 'https://rzp.io.evil.test/x', 'https://user@rzp.io/x', 'http://rzp.io/x', 'https://rzp.io:444/x']) assert.equal(billingLink(url), null); assert.equal(billingLink('https://rzp.io/rzp/test'), 'https://rzp.io/rzp/test');
});

test('billing recovery belongs to the dedicated workspace account when legacy login is also present', async t => {
 const { page, store } = setup(t, { startBilling: () => throwError(() => new HttpErrorResponse({ status: 503 })) }, other);
 await page.load(); page.prepare(plan); await page.confirm(); assert.ok(loadBilling(store, other, bakery)); assert.equal(loadBilling(store, actor, bakery), null);
});
