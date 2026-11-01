import { PendingWaste } from '../models/saas-waste.model';
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const oid = /^[a-f0-9]{24}$/i;
function keyOf(actor: string, bakery: string) {
  if (!oid.test(actor) || !oid.test(bakery)) throw new Error('Invalid wastage recovery identity');
  return `saas-pending-waste-v1:${actor.toLowerCase()}:${bakery.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function valid(value: unknown): value is PendingWaste {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'eventName,input,productName' || typeof value['productName'] !== 'string' || !value['productName'].trim() || value['productName'].length > 120 || typeof value['eventName'] !== 'string' || value['eventName'].length > 120) return false;
  const input = value['input'];
  return record(input) && Object.keys(input).sort().join(',') === 'confirmed,eventId,expectedProductVersion,idempotencyKey,productId,quantity,reason'
    && typeof input['productId'] === 'string' && oid.test(input['productId']) && (input['eventId'] === null || (typeof input['eventId'] === 'string' && oid.test(input['eventId'])))
    && typeof input['quantity'] === 'number' && Number.isSafeInteger(input['quantity']) && input['quantity'] >= 1 && input['quantity'] <= 1000000
    && typeof input['expectedProductVersion'] === 'number' && Number.isSafeInteger(input['expectedProductVersion']) && input['expectedProductVersion'] >= 1
    && typeof input['reason'] === 'string' && !!input['reason'].trim() && input['reason'].length <= 500 && input['confirmed'] === true
    && typeof input['idempotencyKey'] === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input['idempotencyKey']);
}
export function loadPendingWaste(storage: Storage, actor: string, bakery: string): PendingWaste | null {
  const raw = storage.getItem(keyOf(actor, bakery)); if (raw === null) return null;
  if (raw.length > 10000) throw new Error('Invalid wastage recovery record'); const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'actor,bakery,pending,version' || saved['version'] !== 1 || saved['actor'] !== actor.toLowerCase() || saved['bakery'] !== bakery.toLowerCase() || !valid(saved['pending'])) throw new Error('Invalid wastage recovery record');
  return saved['pending'];
}
export function savePendingWaste(storage: Storage, actor: string, bakery: string, pending: PendingWaste) {
  if (!valid(pending)) throw new Error('Invalid pending wastage');
  const key = keyOf(actor, bakery), value = JSON.stringify({ version: 1, actor: actor.toLowerCase(), bakery: bakery.toLowerCase(), pending }), previous = storage.getItem(key);
  if (previous !== null && previous !== value) throw new Error('Resolve the previous wastage entry first');
  storage.setItem(key, value); if (storage.getItem(key) !== value) throw new Error('Wastage recovery did not retain the request');
}
export function clearPendingWaste(storage: Storage, actor: string, bakery: string, key: string) {
  const pending = loadPendingWaste(storage, actor, bakery);
  if (pending && pending.input.idempotencyKey !== key) throw new Error('A different wastage entry cannot be cleared');
  const storageKey = keyOf(actor, bakery); storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) throw new Error('Could not clear wastage recovery');
}
