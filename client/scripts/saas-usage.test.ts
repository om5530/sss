import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasUsage } from '../src/app/pages/saas-lab/saas-usage';
const report = { policy: 'development', usage: { products: { used: 499, limit: 500 } }, revisionsPerRecipeLimit: 100 };
function setup(t: any, handler: (...args: any[]) => any = () => of(report)) {
  const calls: any[] = [];
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: { usage: (...args: any[]) => { calls.push(args); return handler(...args); } } }] });
  const page = runInInjectionContext(injector, () => new SaasUsage()) as any;
  page.bakeryId = '200000000000000000000001'; page.ngOnChanges();
  t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls };
}
test('usage stays hidden until requested and can be hidden or refreshed', async t => {
  const { page, calls } = setup(t); assert.equal(calls.length, 0); assert.equal(page.report(), null);
  await page.load(); assert.deepEqual(calls, [[page.bakeryId]]); assert.equal(page.report().usage.products.used, 499);
  page.hide(); assert.equal(page.report(), null); await page.load(); assert.equal(calls.length, 2);
});
test('late usage responses cannot reveal another bakery or reverse an explicit hide', async t => {
  const response = new Subject<any>(); const { page } = setup(t, () => response);
  const loading = page.load(); page.hide(); response.next(report); await loading; assert.equal(page.report(), null);
  const next = page.load(); page.bakeryId = '300000000000000000000001'; page.ngOnChanges(); response.next(report); await next;
  assert.equal(page.report(), null); assert.equal(page.loading(), false);
});
test('access loss clears cached usage and surfaces the server error', async t => {
  let revoked = false;
  const { page } = setup(t, () => revoked ? throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Owner access required' } })) : of(report));
  await page.load(); assert.ok(page.report()); revoked = true; await page.load();
  assert.equal(page.report(), null); assert.equal(page.error(), 'Owner access required'); assert.equal(page.loading(), false);
});
test('visibility changes hide usage and prevent an in-flight response from restoring it', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const response = new Subject<any>(); const { page } = setup(t, () => response);
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete (globalThis as any).document; });
  const loading = page.load(); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); response.next(report); await loading;
  assert.equal(page.report(), null); assert.equal(page.loading(), false);
});
