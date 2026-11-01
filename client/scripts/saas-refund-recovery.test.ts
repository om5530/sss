import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { savePendingRefund, loadPendingRefund, clearPendingRefund, PendingRefund } from '../src/app/core/utils/saas-refund-recovery';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const pending = (): PendingRefund => ({ orderId: '400000000000000000000001', orderNumber: 'ORD-000001', request: { expectedVersion: 2, expectedRefundPaise: 1000, paymentMethod: 'upi', reason: 'Already returned', confirmed: true, idempotencyKey: randomUUID() } });
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
test('refund recovery retains the exact reviewed request and scopes it by actor and bakery', () => {
  const store = storage(), request = pending(); savePendingRefund(store, actor, bakery, request);
  assert.deepEqual(loadPendingRefund(store, actor, bakery), request); assert.equal(loadPendingRefund(store, other, bakery), null); assert.equal(loadPendingRefund(store, actor, other), null);
  savePendingRefund(store, actor, bakery, request); assert.equal(store.values.size, 1);
  assert.throws(() => savePendingRefund(store, actor, bakery, pending()));
  assert.throws(() => savePendingRefund(store, actor, bakery, { ...request, request: { ...request.request, reason: 'Changed' } }));
  assert.throws(() => clearPendingRefund(store, actor, bakery, randomUUID())); assert.deepEqual(loadPendingRefund(store, actor, bakery), request);
  clearPendingRefund(store, actor, bakery, request.request.idempotencyKey); assert.equal(loadPendingRefund(store, actor, bakery), null);
});
test('invalid, oversized and corrupted refund recovery records fail closed', () => {
  const store = storage(), original = pending();
  for (const request of [{ ...original.request, confirmed: false }, { ...original.request, expectedRefundPaise: 0 }, { ...original.request, expectedRefundPaise: 1.5 }, { ...original.request, paymentMethod: 'online' }, { ...original.request, reason: ' ' }, { ...original.request, idempotencyKey: 'new' }, { ...original.request, expectedVersion: -1 }, { ...original.request, amount: 0 }]) assert.throws(() => savePendingRefund(store, actor, bakery, { ...original, request } as any));
  assert.throws(() => loadPendingRefund(store, 'invalid', bakery));
  savePendingRefund(store, actor, bakery, original); const key = [...store.values.keys()][0], raw = store.values.get(key)!;
  for (const value of ['{bad', 'x'.repeat(4001), JSON.stringify({ ...JSON.parse(raw), actor: other }), JSON.stringify({ ...JSON.parse(raw), extra: true })]) { store.values.set(key, value); assert.throws(() => loadPendingRefund(store, actor, bakery)); }
});
test('silently dropped writes and failed cleanup cannot authorize another refund', () => {
  const store = storage(), request = pending();
  assert.throws(() => savePendingRefund({ ...store, setItem: () => {} }, actor, bakery, request));
  savePendingRefund(store, actor, bakery, request);
  assert.throws(() => clearPendingRefund({ ...store, removeItem: () => {} }, actor, bakery, request.request.idempotencyKey));
  assert.deepEqual(loadPendingRefund(store, actor, bakery), request);
});
