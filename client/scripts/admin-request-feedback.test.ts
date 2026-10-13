import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpRequest, HttpResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { adminActivityInterceptor } from '../src/app/core/interceptors/admin-activity.interceptor';
import { AdminRequestActivity } from '../src/app/core/services/admin-request-activity.service';
import { adminRequestKind } from '../src/app/core/utils/admin-request-state';

function fixture() {
  const injector = Injector.create({ providers: [{ provide: AdminRequestActivity, useClass: AdminRequestActivity }] });
  const activity = injector.get(AdminRequestActivity);
  function request(url: string, method = 'GET') {
    const response = new Subject<any>();
    const subscription = runInInjectionContext(injector, () => adminActivityInterceptor(new HttpRequest(method, url), () => response))
      .subscribe({ error: () => {} });
    return { response, subscription };
  }
  return { activity, request };
}

test('admin fetches, saves and calculations receive the correct feedback; storefront and polling stay quiet', () => {
  assert.equal(adminRequestKind('/api/admin/bakery/materials?search=butter', 'GET'), 'loading');
  assert.equal(adminRequestKind('https://example.com/api/admin/events/123', 'PATCH'), 'saving');
  for (const url of ['/api/admin/bakery/simulate', '/api/admin/bakery/simulate/draft', '/api/admin/orders/quote', '/api/admin/bakery/purchase-requirements']) {
    assert.equal(adminRequestKind(url, 'POST'), 'calculating');
  }
  assert.equal(adminRequestKind('/api/admin/messages/unread-count', 'GET'), null);
  assert.equal(adminRequestKind('/api/products', 'GET'), null);
  assert.equal(adminRequestKind('/api/auth/activity', 'POST'), null);
});

test('overlapping requests keep feedback visible until every request finishes', () => {
  const { activity, request } = fixture();
  const fetch = request('/api/admin/products');
  const save = request('/api/admin/events', 'POST');
  assert.equal(activity.kind(), 'saving');
  save.response.next(new HttpResponse({ status: 200 }));
  save.response.complete();
  assert.equal(activity.kind(), 'loading');
  fetch.response.complete();
  assert.equal(activity.kind(), null);
});

test('failed and cancelled requests clear feedback and allow subsequent requests', () => {
  const { activity, request } = fixture();
  request('/api/admin/bakery/materials', 'POST').response.error(new Error('Offline'));
  assert.equal(activity.kind(), null);
  const calculation = request('/api/admin/bakery/simulate', 'POST');
  assert.equal(activity.kind(), 'calculating');
  calculation.subscription.unsubscribe();
  assert.equal(activity.kind(), null);
  const retry = request('/api/admin/bakery/materials', 'POST');
  assert.equal(activity.kind(), 'saving');
  retry.response.complete();
  assert.equal(activity.kind(), null);
});

test('slow request feedback clears on completion', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { activity, request } = fixture();
  const save = request('/api/admin/events', 'POST');
  t.mock.timers.tick(10_000);
  assert.equal(activity.slow(), true);
  assert.match(activity.message(), /Still working/);
  save.response.complete();
  assert.equal(activity.slow(), false);
  assert.equal(activity.kind(), null);
});

test('a synchronous request failure does not leave a loader stuck', () => {
  const injector = Injector.create({ providers: [{ provide: AdminRequestActivity, useClass: AdminRequestActivity }] });
  const activity = injector.get(AdminRequestActivity);
  runInInjectionContext(injector, () => adminActivityInterceptor(new HttpRequest('GET', '/api/admin/products'), () => { throw new Error('Request failed'); }))
    .subscribe({ error: () => {} });
  assert.equal(activity.kind(), null);
});
