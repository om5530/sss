import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { throwError } from 'rxjs';
import { errorInterceptor } from '../src/app/core/interceptors/error.interceptor';
import { ToastService } from '../src/app/core/services/toast.service';

test('parallel connection failures show one production-safe alert and still reach callers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const toast = new ToastService();
  const injector = Injector.create({ providers: [{ provide: ToastService, useValue: toast }] });
  let failures = 0;
  const fail = () => runInInjectionContext(injector, () => errorInterceptor(
    new HttpRequest('GET', '/api/admin/bakery/recipes'),
    () => throwError(() => new HttpErrorResponse({ status: 0 })),
  )).subscribe({ error: () => failures++ });
  for (let i = 0; i < 6; i++) fail();
  assert.equal(failures, 6);
  assert.equal(toast.toasts().length, 1);
  assert.doesNotMatch(toast.toasts()[0].message, /4000|localhost|API running/);
  t.mock.timers.tick(5000);
  assert.equal(toast.toasts().length, 0);
  fail();
  assert.equal(toast.toasts().length, 1);
  t.mock.timers.tick(5000);
  injector.destroy();
});

test('different errors remain visible and a dismissed alert can be shown again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const toast = new ToastService();
  toast.error('Connection interrupted');
  toast.error('Recipe could not be saved');
  assert.equal(toast.toasts().length, 2);
  toast.dismiss(toast.toasts()[0].id);
  toast.error('Connection interrupted');
  assert.equal(toast.toasts().length, 2);
  t.mock.timers.tick(5000);
  assert.equal(toast.toasts().length, 0);
});
