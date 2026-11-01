import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasSubscription } from '../src/app/pages/saas-lab/saas-subscription';
const report = { policy: 'subscription-preview', planName: 'Starter preview', access: 'restricted', writable: false, billingConnected: false, subscription: { planId: 'starter', status: 'cancelled', version: 2 } };
function setup(t: any, overrides: Record<string, unknown> = {}) {
 const calls: any[] = []; const api = { subscription: (...args: any[]) => { calls.push(args); return of(report); }, subscriptionHistory: () => of({ entries: [], nextCursor: null }), ...overrides };
 const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }] }); const page = runInInjectionContext(injector, () => new SaasSubscription()) as any;
 page.bakeryId = 'a'; page.ngOnChanges(); t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls };
}
test('plan information stays hidden until requested and can be cleared explicitly', async t => {
 const { page, calls } = setup(t); assert.equal(calls.length, 0); await page.load(); assert.equal(page.report().writable, false); assert.equal(calls.length, 1); page.hide(); assert.equal(page.report(), null); assert.deepEqual(page.changes(), []);
});
test('late plan responses cannot reveal a hidden or different bakery plan', async t => {
 const response = new Subject<any>(); const { page } = setup(t, { subscription: () => response });
 let loading = page.load(); page.hide(); response.next(report); await loading; assert.equal(page.report(), null);
 loading = page.load(); page.bakeryId = 'b'; page.ngOnChanges(); response.next(report); await loading; assert.equal(page.report(), null);
});
test('history pagination is scoped and resets when the plan is hidden or access fails', async t => {
 const requests: any[] = []; let fail = false; const { page } = setup(t, { subscriptionHistory: (...args: any[]) => { requests.push(args); return fail ? throwError(() => new HttpErrorResponse({ status: 403 })) : of({ entries: [{ _id: String(requests.length), after: report.subscription }], nextCursor: requests.length === 1 ? 'cursor' : null }); } });
 await page.load(); await page.history(); await page.history(true); assert.equal(page.changes().length, 2); assert.deepEqual(requests, [['a', undefined], ['a', 'cursor']]);
 fail = true; await page.history(); assert.deepEqual(page.changes(), []); assert.equal(page.report(), null); assert.equal(page.cursor(), null); assert.ok(page.error());
});
test('late history cannot restore a hidden plan or replace refreshed information', async t => {
 const response = new Subject<any>(); const { page } = setup(t, { subscriptionHistory: () => response }); await page.load(); const history = page.history(); page.hide(); response.next({ entries: [{ _id: 'old' }], nextCursor: null }); await history; assert.deepEqual(page.changes(), []); assert.equal(page.report(), null);
});
