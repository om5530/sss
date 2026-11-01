import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasLab } from '../src/app/pages/saas-lab/saas-lab';
import { SaasService } from '../src/app/core/services/saas.service';

const bakery = (id: string, role = 'owner') => ({ _id: id, name: 'Demo ' + id, slug: id, role, version: 1, currency: 'inr', timezone: 'Asia/Kolkata' });
const product = { _id: 'cake-1', name: 'Cake', slug: 'cake', category: 'Cakes', pricePaise: 19900, stockCount: 9, description: '', available: true, version: 1 };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function setup(overrides: Record<string, unknown> = {}) {
  const cleanups: (() => void)[] = [], writes: unknown[] = [];
  const api = {
    bakeries: () => of([bakery('a'), bakery('b')]),
    bakeryContext: (id: string) => of(bakery(id)),
    products: () => of({ products: [product], nextCursor: null }),
    createProduct: (...args: unknown[]) => { writes.push(args); return of(product); },
    updateProduct: (...args: unknown[]) => { writes.push(args); return of(product); },
    ...overrides,
  };
  const injector = Injector.create({ providers: [
    { provide: SaasService, useValue: api },
    { provide: DestroyRef, useValue: { onDestroy: (fn: () => void) => { cleanups.push(fn); return () => {}; } } },
  ] });
  const page = runInInjectionContext(injector, () => new SaasLab()) as any;
  await tick();
  return { page, api, writes, cleanup: () => { cleanups.forEach(fn => fn()); injector.destroy(); } };
}

test('switching bakeries clears prior data immediately and ignores slower previous responses', async () => {
  const a = new Subject<any>(), b = new Subject<any>();
  const { page, cleanup } = await setup({ bakeryContext: (id: string) => id === 'a' ? a : b });
  page.products.set([{ ...product, name: 'Old bakery secret' }]);
  const first = page.selectBakery('a');
  assert.deepEqual(page.products(), []); assert.equal(page.selected(), null);
  const second = page.selectBakery('b');
  b.next(bakery('b')); await second;
  assert.equal(page.selected()._id, 'b');
  a.next(bakery('a')); await first;
  assert.equal(page.selected()._id, 'b'); assert.equal(page.loading(), false);
  cleanup();
});

test('a previous catalogue request cannot repopulate products after changing the bakery', async () => {
  const slow = new Subject<any>(); let calls = 0;
  const { page, cleanup } = await setup({ products: () => ++calls === 2 ? slow : of({ products: [product], nextCursor: null }) });
  await page.selectBakery('a');
  const old = page.loadProducts();
  await page.selectBakery('b');
  slow.next({ products: [{ ...product, name: 'A-only private product' }], nextCursor: 'old-cursor' }); await old;
  assert.equal(page.selected()._id, 'b'); assert.equal(page.products()[0].name, 'Cake'); assert.equal(page.nextCursor(), null);
  cleanup();
});

test('price input preserves exact paise and rejects excess precision or invalid stock before saving', async () => {
  const { page, writes, cleanup } = await setup(); await page.selectBakery('a'); page.edit('new');
  page.form = { name: 'Cake', slug: 'cake', category: 'Cakes', description: '', price: '0.10', stock: '', available: true };
  await page.saveProduct();
  assert.equal((writes[0] as any)[0], 'a'); assert.equal((writes[0] as any)[1].pricePaise, 10);
  assert.equal((writes[0] as any)[1].stockCount, null);
  for (const price of ['19.999', '1e3', '-1', '', '1000000.01']) {
    page.edit('new'); page.form.price = price; await page.saveProduct();
  }
  page.form.price = '199'; page.form.stock = '1.5'; await page.saveProduct();
  assert.equal(writes.length, 1);
  cleanup();
});

test('failed version checks retain the editor and draft; staff cannot send mutations', async () => {
  const { page, writes, cleanup } = await setup({ updateProduct: () => throwError(() => new HttpErrorResponse({ status: 409 })) });
  await page.selectBakery('a'); page.edit(product); page.form.price = '219.00'; await page.saveProduct();
  assert.equal(page.editor()._id, product._id); assert.equal(page.form.price, '219.00'); assert.match(page.error(), /changed/);
  page.selected.set(bakery('a', 'staff')); page.editor.set('new'); await page.saveProduct();
  page.archiveTarget.set(product); await page.confirmArchive();
  assert.equal(writes.length, 0); assert.equal(page.busy(), false);
  cleanup();
});

test('archive requires an explicit target and sends the selected product version and bakery', async () => {
  const { page, writes, cleanup } = await setup(); await page.selectBakery('b');
  await page.confirmArchive(); assert.equal(writes.length, 0);
  page.archiveTarget.set(product); await page.confirmArchive();
  assert.deepEqual(writes[0], ['b', product._id, { archived: true, expectedVersion: 1 }]);
  assert.equal(page.archiveTarget(), null); cleanup();
});

test('access failures clear stale catalogue data and destroyed components ignore late responses', async () => {
  const slow = new Subject<any>(); let calls = 0;
  const { page, cleanup } = await setup({ products: () => ++calls === 1 ? of({ products: [product], nextCursor: null })
    : calls === 2 ? throwError(() => new HttpErrorResponse({ status: 403 })) : slow });
  await page.selectBakery('a'); await page.loadProducts();
  assert.deepEqual(page.products(), []); assert.equal(page.nextCursor(), null); assert.match(page.error(), /access/);
  const pending = page.loadProducts(); cleanup();
  slow.next({ products: [product], nextCursor: null }); await pending;
  assert.deepEqual(page.products(), []);
});
