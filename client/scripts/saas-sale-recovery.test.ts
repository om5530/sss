import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clearPendingSale, loadPendingSale, savePendingSale } from '../src/app/core/utils/saas-sale-recovery';
import { SaasSaleInput } from '../src/app/core/models/saas-sales.model';
const actor = '100000000000000000000001', bakery = '200000000000000000000001', other = '300000000000000000000001';
const request = (): SaasSaleInput => ({ eventId: null, items: [{ productId: '400000000000000000000001', quantity: 1, expectedUnitPricePaise: 19900 }], discountPaise: 0, paymentStatus: 'paid', paymentMethod: 'cash', comment: 'Demo', idempotencyKey: randomUUID() });
function store() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }

test('recovery retains the exact retry key, reviewed prices and payload across reloads', () => {
  const storage = store(), input = request(); savePendingSale(storage, actor, bakery, input);
  const restored = loadPendingSale(storage, actor, bakery); assert.deepEqual(restored, input);
  input.comment = 'Unsaved edit'; assert.equal(loadPendingSale(storage, actor, bakery)!.comment, 'Demo');
  savePendingSale(storage, actor, bakery, restored!); clearPendingSale(storage, actor, bakery, restored!.idempotencyKey);
  assert.equal(loadPendingSale(storage, actor, bakery), null);
});

test('pending submissions are isolated by both bakery and signed-in actor', () => {
  const storage = store(); savePendingSale(storage, actor, bakery, request());
  assert.equal(loadPendingSale(storage, actor, other), null); assert.equal(loadPendingSale(storage, other, bakery), null);
  clearPendingSale(storage, other, bakery, randomUUID()); assert.ok(loadPendingSale(storage, actor, bakery));
});

test('an uncertain submission cannot be overwritten or cleared with a different retry key', () => {
  const storage = store(), input = request(); savePendingSale(storage, actor, bakery, input);
  assert.throws(() => savePendingSale(storage, actor, bakery, request()), /previous pending/);
  assert.throws(() => savePendingSale(storage, actor, bakery, { ...input, discountPaise: 100 }), /previous pending/);
  assert.throws(() => clearPendingSale(storage, actor, bakery, randomUUID()), /different pending/);
  assert.deepEqual(loadPendingSale(storage, actor, bakery), input);
});

test('storage failures, silent drops and corrupted recovery records fail closed', () => {
  const storage = store(); const input = request();
  assert.throws(() => savePendingSale({ ...storage, setItem: () => { throw new Error('Quota'); } }, actor, bakery, input));
  assert.throws(() => savePendingSale({ ...storage, setItem: () => {} }, actor, bakery, input));
  savePendingSale(storage, actor, bakery, input);
  const key = [...storage.values.keys()][0]; storage.values.set(key, '{bad-json');
  assert.throws(() => loadPendingSale(storage, actor, bakery));
  assert.throws(() => clearPendingSale(storage, actor, bakery, input.idempotencyKey)); assert.equal(storage.getItem(key), '{bad-json');
});

test('malformed prices, quantities, identities and payload fields never enter recovery storage', () => {
  const storage = store();
  for (const patch of [{ discountPaise: 0.1 }, { paymentMethod: 'online' }, { comment: 'a'.repeat(1001) }, { idempotencyKey: 'retry' },
    { items: [{ productId: 'invalid', quantity: 1, expectedUnitPricePaise: 1 }] }, { items: [] }, { costSnapshot: [] }]) {
    assert.throws(() => savePendingSale(storage, actor, bakery, { ...request(), ...patch } as any));
  }
  assert.throws(() => savePendingSale(storage, 'unknown', bakery, request())); assert.equal(storage.values.size, 0);
});
