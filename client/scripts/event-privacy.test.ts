import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Injector, DestroyRef, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { AdminEvents } from '../src/app/pages/admin/events/admin-events';
import { AdminService } from '../src/app/core/services/admin.service';
import { ToastService } from '../src/app/core/services/toast.service';
import { AdminProductListState } from '../src/app/pages/admin/shared/admin-product-list-state';

function setup() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  const cleanups: (() => void)[] = [];
  const injector = Injector.create({ providers: [
    { provide: AdminService, useValue: {} }, { provide: ToastService, useValue: {} },
    { provide: ActivatedRoute, useValue: { queryParamMap: EMPTY } }, { provide: Router, useValue: {} },
    { provide: AdminProductListState, useValue: {} },
    { provide: DestroyRef, useValue: { destroyed: false, onDestroy: (fn: () => void) => { cleanups.push(fn); return () => {}; } } },
  ] });
  const page = runInInjectionContext(injector, () => new AdminEvents()) as any;
  return { page, doc, cleanup: () => { cleanups.forEach(fn => fn()); injector.destroy(); } };
}

test('financial reports start hidden, explicitly reveal, and can hide again including negative and missing values', () => {
  const { page, cleanup } = setup();
  assert.equal(page.figuresVisible(), false);
  for (const amount of [9561.16, -9561.16, 0, null]) assert.equal(page.money(amount), '••••');
  assert.equal(page.count(77), '••••');
  page.toggleFigures();
  assert.match(page.money(-9561.16), /9,561\.16/);
  assert.equal(page.money(null), 'Not set');
  assert.equal(page.count(77), '77');
  page.toggleFigures();
  assert.equal(page.money(-9561.16), '••••');
  cleanup();
});

test('switching away hides figures and returning does not reveal them automatically', () => {
  const { page, doc, cleanup } = setup();
  page.toggleFigures();
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.figuresVisible(), false);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.figuresVisible(), false);
  page.toggleFigures();
  cleanup();
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.figuresVisible(), true, 'Destroyed pages remove their listener');
});

test('close-event confirmation respects hidden figures while exports can retain actual currency formatting', () => {
  const { page, cleanup } = setup();
  page.confirmation.set({ action: 'close', event: { eventName: 'Stall', netProfit: -9561.16 } });
  assert.doesNotMatch(page.confirmationMessage(), /9,561|9561/);
  page.toggleFigures();
  assert.match(page.confirmationMessage(), /9,561\.16/);
  page.toggleFigures();
  assert.match(page.rupees(-9561.16), /9,561\.16/);
  cleanup();
});
