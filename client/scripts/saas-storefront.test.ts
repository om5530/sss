import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { SaasService } from '../src/app/core/services/saas.service';
import { SaasSettings } from '../src/app/pages/saas-lab/saas-settings';
import { SaasMenu } from '../src/app/pages/saas-lab/saas-menu';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const defaults = { pickupReservationMinutes: 30, acceptCustomerOrders: false, published: false, tagline: '', description: '', contactPhone: '', contactEmail: '', address: '', openingHours: '', showUnavailable: false, version: 0 };

test('settings require review and confirmation, and stale saves retain the owner draft', async () => {
  const calls: unknown[] = [];
  const api = { storefrontSettings: () => of(defaults), updateStorefront: (...args: unknown[]) => { calls.push(args); return throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Settings changed' } })); } };
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: api }] });
  const page = runInInjectionContext(injector, () => new SaasSettings()) as any; page.bakeryId = 'a'; await page.load();
  page.form.published = true; page.form.tagline = 'A new menu'; page.prepare();
  assert.equal(calls.length, 0); page.form.tagline = 'Unconfirmed later edit'; await page.confirm();
  assert.equal((calls[0] as any)[1].tagline, 'A new menu'); assert.equal((calls[0] as any)[1].expectedVersion, 0);
  assert.ok(page.review()); assert.equal(page.current().version, 0); assert.match(page.error(), /changed/);
  page.ngOnDestroy(); injector.destroy();
});

test('changing the bakery clears private settings and ignores an earlier response', async () => {
  const response = new Subject<any>(); let count = 0;
  const injector = Injector.create({ providers: [{ provide: SaasService, useValue: { storefrontSettings: () => ++count === 1 ? response : of({ ...defaults, tagline: 'B menu' }) } }] });
  const page = runInInjectionContext(injector, () => new SaasSettings()) as any; page.bakeryId = 'a';
  const first = page.load(); page.bakeryId = 'b'; await page.load(); response.next({ ...defaults, contactEmail: 'a-private@example.test' }); await first;
  assert.equal(page.current().tagline, 'B menu'); assert.equal(page.form.contactEmail, '');
  page.ngOnDestroy(); injector.destroy();
});

test('public menu navigation cannot display the previous bakery after a delayed response', async () => {
  const params = new Subject<any>(), slow = new Subject<any>();
  const injector = Injector.create({ providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: SaasService, useValue: { publicMenu: (slug: string) => slug === 'a' ? slow : of({ bakery: { name: 'B' }, profile: {}, products: [], nextCursor: null }) } }] });
  const page = runInInjectionContext(injector, () => new SaasMenu()) as any;
  params.next(convertToParamMap({ slug: 'a' })); params.next(convertToParamMap({ slug: 'b' })); await tick();
  slow.next({ bakery: { name: 'A' }, profile: {}, products: [], nextCursor: null }); await tick();
  assert.equal(page.menu().bakery.name, 'B'); page.ngOnDestroy(); injector.destroy();
});

test('a disabled or failed menu recheck clears previously visible profile and product data', async () => {
  const params = new Subject<any>(); let count = 0;
  const injector = Injector.create({ providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: SaasService, useValue: { publicMenu: () => ++count === 1
    ? of({ bakery: { name: 'A' }, profile: { contactEmail: 'a@example.test' }, products: [], nextCursor: null }) : throwError(() => new HttpErrorResponse({ status: 404 })) } }] });
  const page = runInInjectionContext(injector, () => new SaasMenu()) as any; params.next(convertToParamMap({ slug: 'a' })); await tick();
  assert.ok(page.menu()); await page.load(); assert.equal(page.menu(), null); assert.match(page.error(), /unavailable/);
  page.ngOnDestroy(); injector.destroy();
});

test('branding review freezes theme and normalized mark and rejects changes from later draft edits', async () => {
  const calls: any[] = []; const injector = Injector.create({ providers: [{ provide: SaasService, useValue: { storefrontSettings: () => of({ ...defaults, brandTheme: 'gold', brandMark: '' }), updateStorefront: (...args: any[]) => { calls.push(args); return of({ ...args[1], version: 1 }); } } }] });
  const page = runInInjectionContext(injector, () => new SaasSettings()) as any; page.bakeryId = 'a'; await page.load(); page.form.brandTheme = 'rose'; page.form.brandMark = 'gb'; page.prepare(); page.form.brandTheme = 'sage'; page.form.brandMark = 'NO'; await page.confirm();
  assert.equal(calls[0][1].brandTheme, 'rose'); assert.equal(calls[0][1].brandMark, 'GB'); assert.equal(page.current().brandTheme, 'rose'); page.ngOnDestroy(); injector.destroy();
});

test('menu branding resets on tenant navigation and failed rechecks, with safe defaults for older settings', async () => {
  const params = new Subject<any>(); let fail = false;
  const injector = Injector.create({ providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: SaasService, useValue: { publicMenu: (slug: string) => fail ? throwError(() => new Error('offline')) : of({ bakery: { name: slug }, profile: slug === 'a' ? { brandTheme: 'rose' } : {}, products: [], nextCursor: null }) } }] });
  const page = runInInjectionContext(injector, () => new SaasMenu()) as any; params.next(convertToParamMap({ slug: 'a' })); await tick(); assert.equal(page.theme(), 'rose'); params.next(convertToParamMap({ slug: 'b' })); await tick(); assert.equal(page.theme(), 'gold'); params.next(convertToParamMap({ slug: 'a' })); await tick(); fail = true; await page.load(); assert.equal(page.theme(), 'gold'); assert.equal(page.menu(), null); page.ngOnDestroy(); injector.destroy();
});
