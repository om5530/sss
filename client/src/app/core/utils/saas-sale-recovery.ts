import { SaasSaleInput } from '../models/saas-sales.model';
interface RecoveryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const objectId = /^[a-f0-9]{24}$/i;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function keyOf(actorId: string, bakeryId: string): string {
  if (!objectId.test(actorId) || !objectId.test(bakeryId)) throw new Error('Invalid sale recovery identity');
  return `saas-pending-sale-v1:${actorId.toLowerCase()}:${bakeryId.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, max: number): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max; }
function validRequest(value: unknown): value is SaasSaleInput {
  if (!record(value) || Object.keys(value).sort().join(',') !== ['eventId', 'items', 'discountPaise', 'paymentStatus', 'paymentMethod', 'comment', 'idempotencyKey'].sort().join(',')) return false;
  if (value['eventId'] !== null && (typeof value['eventId'] !== 'string' || !objectId.test(value['eventId']))) return false;
  if (typeof value['idempotencyKey'] !== 'string' || !uuid.test(value['idempotencyKey']) || typeof value['comment'] !== 'string' || value['comment'].length > 1000 || !integer(value['discountPaise'], 1000000000000)) return false;
  if (value['paymentStatus'] === 'paid') { if (typeof value['paymentMethod'] !== 'string' || !['cash', 'upi', 'card'].includes(value['paymentMethod'])) return false; }
  else if (value['paymentStatus'] !== 'unpaid' || value['paymentMethod'] !== null) return false;
  const items = value['items'];
  if (!Array.isArray(items) || !items.length || items.length > 100) return false;
  const seen = new Set<string>();
  return items.every(line => {
    if (!record(line) || Object.keys(line).sort().join(',') !== 'expectedUnitPricePaise,productId,quantity'
      || typeof line['productId'] !== 'string' || !objectId.test(line['productId']) || !integer(line['quantity'], 10000)
      || line['quantity'] === 0 || !integer(line['expectedUnitPricePaise'], 100000000)) return false;
    const id = line['productId'].toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true;
  });
}
export function savePendingSale(storage: RecoveryStorage, actorId: string, bakeryId: string, request: SaasSaleInput): void {
  if (!validRequest(request)) throw new Error('Invalid pending sale');
  const key = keyOf(actorId, bakeryId), value = JSON.stringify({ version: 1, actorId: actorId.toLowerCase(), bakeryId: bakeryId.toLowerCase(), request });
  if (value.length > 50000) throw new Error('Pending sale exceeds recovery limits');
  const existing = storage.getItem(key);
  // An uncertain previous submission must be resolved before a new key or
  // changed payload can replace it. Retrying the same request is safe.
  if (existing !== null && existing !== value) throw new Error('Resolve the previous pending sale first');
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('Sale recovery storage did not retain the request');
}
export function loadPendingSale(storage: RecoveryStorage, actorId: string, bakeryId: string): SaasSaleInput | null {
  const raw = storage.getItem(keyOf(actorId, bakeryId)); if (raw === null) return null;
  if (raw.length > 50000) throw new Error('Invalid pending sale recovery record');
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'actorId,bakeryId,request,version' || saved['version'] !== 1
    || saved['actorId'] !== actorId.toLowerCase() || saved['bakeryId'] !== bakeryId.toLowerCase() || !validRequest(saved['request'])) throw new Error('Invalid pending sale recovery record');
  return saved['request'];
}
export function clearPendingSale(storage: RecoveryStorage, actorId: string, bakeryId: string, idempotencyKey: string): void {
  const saved = loadPendingSale(storage, actorId, bakeryId);
  if (saved && saved.idempotencyKey !== idempotencyKey) throw new Error('A different pending submission must not be cleared');
  const key = keyOf(actorId, bakeryId); storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error('Could not clear sale recovery record');
}
