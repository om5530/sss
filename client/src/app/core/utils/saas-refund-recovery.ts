import { SaasRefundInput } from '../models/saas-sales.model';
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export interface PendingRefund { orderId: string; orderNumber: string; request: SaasRefundInput; }
const objectId = /^[a-f0-9]{24}$/i;
function keyOf(actor: string, bakery: string) {
  if (!objectId.test(actor) || !objectId.test(bakery)) throw new Error('Invalid refund recovery identity');
  return `saas-pending-refund-v1:${actor.toLowerCase()}:${bakery.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function valid(value: unknown): value is PendingRefund {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'orderId,orderNumber,request'
    || typeof value['orderId'] !== 'string' || !objectId.test(value['orderId']) || typeof value['orderNumber'] !== 'string' || !/^ORD-\d{6,16}$/.test(value['orderNumber'])) return false;
  const request = value['request'];
  return record(request) && Object.keys(request).sort().join(',') === 'confirmed,expectedRefundPaise,expectedVersion,idempotencyKey,paymentMethod,reason'
    && typeof request['expectedVersion'] === 'number' && Number.isSafeInteger(request['expectedVersion']) && request['expectedVersion'] >= 1
    && typeof request['expectedRefundPaise'] === 'number' && Number.isSafeInteger(request['expectedRefundPaise']) && request['expectedRefundPaise'] > 0 && request['expectedRefundPaise'] <= 1000000000000
    && request['confirmed'] === true && typeof request['reason'] === 'string' && request['reason'].trim().length > 0 && request['reason'].length <= 500
    && ['cash', 'upi', 'card'].includes(request['paymentMethod'] as string)
    && typeof request['idempotencyKey'] === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request['idempotencyKey']);
}
export function loadPendingRefund(storage: Storage, actor: string, bakery: string): PendingRefund | null {
  const raw = storage.getItem(keyOf(actor, bakery)); if (raw === null) return null;
  if (raw.length > 4000) throw new Error('Invalid refund recovery record');
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'actor,bakery,pending,version' || saved['version'] !== 1
    || saved['actor'] !== actor.toLowerCase() || saved['bakery'] !== bakery.toLowerCase() || !valid(saved['pending'])) throw new Error('Invalid refund recovery record');
  return saved['pending'];
}
export function savePendingRefund(storage: Storage, actor: string, bakery: string, pending: PendingRefund) {
  if (!valid(pending)) throw new Error('Invalid pending refund');
  const key = keyOf(actor, bakery), value = JSON.stringify({ version: 1, actor: actor.toLowerCase(), bakery: bakery.toLowerCase(), pending });
  const previous = storage.getItem(key);
  if (previous !== null && previous !== value) throw new Error('Resolve the previous refund first');
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('Refund recovery storage did not retain the request');
}
export function clearPendingRefund(storage: Storage, actor: string, bakery: string, key: string) {
  const pending = loadPendingRefund(storage, actor, bakery);
  if (pending && pending.request.idempotencyKey !== key) throw new Error('A different refund cannot be cleared');
  const storageKey = keyOf(actor, bakery); storage.removeItem(storageKey);
  if (storage.getItem(storageKey) !== null) throw new Error('Could not clear refund recovery');
}
