import { PendingInventory } from '../models/saas-inventory.model';
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const oid = /^[a-f0-9]{24}$/i;
function keyOf(actor: string, bakery: string) {
  if (!oid.test(actor) || !oid.test(bakery)) throw new Error('Invalid inventory recovery identity');
  return `saas-pending-inventory-v1:${actor.toLowerCase()}:${bakery.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function valid(value: unknown): value is PendingInventory {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'input,materialName' || typeof value['materialName'] !== 'string' || !value['materialName'].trim() || value['materialName'].length > 120) return false;
  const input = value['input'];
  if (!record(input) || Object.keys(input).sort().join(',') !== 'confirmed,expectedMaterialVersion,expectedStockVersion,idempotencyKey,kind,materialId,quantity,reason,uom') return false;
  return typeof input['materialId'] === 'string' && oid.test(input['materialId']) && ['opening', 'receipt', 'waste', 'count'].includes(input['kind'] as string)
    && typeof input['quantity'] === 'string' && /^\d{1,10}(?:\.\d{1,6})?$/.test(input['quantity']) && Number(input['quantity']) <= 1000000000 && (['opening', 'count'].includes(input['kind'] as string) || Number(input['quantity']) > 0)
    && ['mg', 'g', 'kg', 'ml', 'L', 'piece', 'dozen', 'packet', 'box'].includes(input['uom'] as string)
    && typeof input['expectedMaterialVersion'] === 'number' && Number.isSafeInteger(input['expectedMaterialVersion']) && input['expectedMaterialVersion'] >= 1
    && typeof input['expectedStockVersion'] === 'number' && Number.isSafeInteger(input['expectedStockVersion']) && input['expectedStockVersion'] >= (input['kind'] === 'opening' ? 0 : 1)
    && typeof input['reason'] === 'string' && !!input['reason'].trim() && input['reason'].length <= 500 && input['confirmed'] === true
    && typeof input['idempotencyKey'] === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input['idempotencyKey']);
}
export function loadPendingInventory(storage: Storage, actor: string, bakery: string): PendingInventory | null {
  const raw = storage.getItem(keyOf(actor, bakery)); if (raw === null) return null;
  if (raw.length > 10000) throw new Error('Invalid inventory recovery record');
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'actor,bakery,pending,version' || saved['version'] !== 1 || saved['actor'] !== actor.toLowerCase() || saved['bakery'] !== bakery.toLowerCase() || !valid(saved['pending'])) throw new Error('Invalid inventory recovery record');
  return saved['pending'];
}
export function savePendingInventory(storage: Storage, actor: string, bakery: string, pending: PendingInventory) {
  if (!valid(pending)) throw new Error('Invalid pending inventory');
  const key = keyOf(actor, bakery), value = JSON.stringify({ version: 1, actor: actor.toLowerCase(), bakery: bakery.toLowerCase(), pending }), previous = storage.getItem(key);
  if (previous !== null && previous !== value) throw new Error('Resolve the previous inventory entry first');
  storage.setItem(key, value); if (storage.getItem(key) !== value) throw new Error('Inventory recovery did not retain the request');
}
export function clearPendingInventory(storage: Storage, actor: string, bakery: string, key: string) {
  const pending = loadPendingInventory(storage, actor, bakery);
  if (pending && pending.input.idempotencyKey !== key) throw new Error('A different inventory entry cannot be cleared');
  const storageKey = keyOf(actor, bakery); storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) throw new Error('Could not clear inventory recovery');
}
