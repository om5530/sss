import { PendingProduction } from '../models/saas-production.model';
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const objectId = /^[a-f0-9]{24}$/i;
function keyOf(actor: string, bakery: string) {
  if (!objectId.test(actor) || !objectId.test(bakery)) throw new Error('Invalid production recovery identity');
  return `saas-pending-production-v1:${actor.toLowerCase()}:${bakery.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, max: number) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max; }
function valid(value: unknown): value is PendingProduction {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'input,producedPieces,productName' || typeof value['productName'] !== 'string'
    || !value['productName'].trim() || value['productName'].length > 120 || !integer(value['producedPieces'], 1000000)) return false;
  const input = value['input'];
  return record(input) && ['batches,confirmed,expectedProductVersion,idempotencyKey,note,productId,revisionId', 'batches,confirmed,expectedProductVersion,idempotencyKey,inventoryFingerprint,note,productId,revisionId'].includes(Object.keys(input).sort().join(','))
    && (input['inventoryFingerprint'] === undefined || (typeof input['inventoryFingerprint'] === 'string' && /^[a-f0-9]{64}$/i.test(input['inventoryFingerprint'])))
    && typeof input['productId'] === 'string' && objectId.test(input['productId']) && typeof input['revisionId'] === 'string' && objectId.test(input['revisionId'])
    && integer(input['batches'], 1000) && integer(input['expectedProductVersion'], Number.MAX_SAFE_INTEGER) && input['confirmed'] === true
    && typeof input['note'] === 'string' && input['note'].length <= 1000 && typeof input['idempotencyKey'] === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input['idempotencyKey']);
}
export function loadPendingProduction(storage: Storage, actor: string, bakery: string): PendingProduction | null {
  const raw = storage.getItem(keyOf(actor, bakery)); if (raw === null) return null;
  if (raw.length > 10000) throw new Error('Invalid production recovery record');
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'actor,bakery,pending,version' || saved['version'] !== 1
    || saved['actor'] !== actor.toLowerCase() || saved['bakery'] !== bakery.toLowerCase() || !valid(saved['pending'])) throw new Error('Invalid production recovery record');
  return saved['pending'];
}
export function savePendingProduction(storage: Storage, actor: string, bakery: string, pending: PendingProduction) {
  if (!valid(pending)) throw new Error('Invalid pending production');
  const key = keyOf(actor, bakery), value = JSON.stringify({ version: 1, actor: actor.toLowerCase(), bakery: bakery.toLowerCase(), pending });
  const previous = storage.getItem(key);
  if (previous !== null && previous !== value) throw new Error('Resolve the previous production entry first');
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('Production recovery did not retain the request');
}
export function clearPendingProduction(storage: Storage, actor: string, bakery: string, key: string) {
  const pending = loadPendingProduction(storage, actor, bakery);
  if (pending && pending.input.idempotencyKey !== key) throw new Error('A different production entry cannot be cleared');
  const storageKey = keyOf(actor, bakery); storage.removeItem(storageKey);
  if (storage.getItem(storageKey) !== null) throw new Error('Could not clear production recovery');
}
