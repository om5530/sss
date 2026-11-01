import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasStockHistory } from '../src/app/pages/saas-lab/saas-stock-history';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(t: any, handler: (...args: any[]) => any) {
  const calls: any[] = [];
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: { stockHistory: (...args: any[]) => { calls.push(args); return handler(...args); } } }] });
  const page = runInInjectionContext(injector, () => new SaasStockHistory()) as any;
  page.bakeryId = 'bakery-a'; page.productId = 'product-a'; page.name = 'Cake';
  t.after(() => { page.ngOnDestroy(); injector.destroy(); }); return { page, calls };
}
test('stock history pages only the selected bakery and product and refresh replaces prior rows', async t => {
  let count = 0;
  const { page, calls } = setup(t, () => ++count === 1 ? of({ entries: [{ _id: 'sale', kind: 'sale' }], nextCursor: 'cursor' }) : of({ entries: [{ _id: 'opening', kind: 'opening' }], nextCursor: null }));
  page.ngOnChanges(); await tick(); assert.equal(page.entries()[0]._id, 'sale'); await page.load(true);
  assert.deepEqual(calls, [['bakery-a', 'product-a', undefined], ['bakery-a', 'product-a', 'cursor']]); assert.equal(page.entries().length, 2);
  await page.load(); assert.deepEqual(page.entries().map((row: any) => row._id), ['opening']);
});
test('late stock histories cannot display the previous bakery or return after destruction', async t => {
  const first = new Subject<any>(), second = new Subject<any>(); let count = 0;
  const { page } = setup(t, () => ++count === 1 ? first : second);
  page.ngOnChanges(); page.bakeryId = 'bakery-b'; page.productId = 'product-b'; page.ngOnChanges();
  first.next({ entries: [{ _id: 'foreign' }], nextCursor: null }); await tick(); assert.deepEqual(page.entries(), []);
  page.ngOnDestroy(); second.next({ entries: [{ _id: 'late' }], nextCursor: null }); await tick(); assert.deepEqual(page.entries(), []);
});
test('access failures clear the visible history and paging state', async t => {
  let count = 0;
  const { page } = setup(t, () => ++count === 1 ? of({ entries: [{ _id: 'sale' }], nextCursor: 'cursor' }) : throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Owner access required' } })));
  page.ngOnChanges(); await tick(); await page.load(true);
  assert.deepEqual(page.entries(), []); assert.equal(page.cursor(), null); assert.equal(page.error(), 'Owner access required');
});
