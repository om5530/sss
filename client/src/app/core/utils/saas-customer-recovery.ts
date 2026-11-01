import { SaasCustomerSubmit } from '../models/saas-customer.model';
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
const oid = /^[a-f0-9]{24}$/i;
function keyOf(slug: string, customer: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60 || !oid.test(customer)) throw new Error('Invalid customer recovery context');
  return `saas-customer-order-v1:${slug}:${customer.toLowerCase()}`;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function valid(value: unknown): value is SaasCustomerSubmit {
  if (!record(value) || !['comment,confirmed,idempotencyKey,items', 'comment,confirmed,expectedReservationMinutes,idempotencyKey,items'].includes(Object.keys(value).sort().join(',')) || value['confirmed'] !== true
    || typeof value['comment'] !== 'string' || value['comment'].length > 1000 || typeof value['idempotencyKey'] !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value['idempotencyKey']) || !Array.isArray(value['items']) || !value['items'].length || value['items'].length > 100) return false;
  if (value['expectedReservationMinutes'] !== undefined && (typeof value['expectedReservationMinutes'] !== 'number' || !Number.isSafeInteger(value['expectedReservationMinutes']) || value['expectedReservationMinutes'] < 5 || value['expectedReservationMinutes'] > 1440)) return false;
  const seen = new Set<string>();
  return value['items'].every(line => {
    if (!record(line) || Object.keys(line).sort().join(',') !== 'expectedUnitPricePaise,productId,quantity' || typeof line['productId'] !== 'string' || !oid.test(line['productId'])
      || typeof line['quantity'] !== 'number' || !Number.isSafeInteger(line['quantity']) || line['quantity'] < 1 || line['quantity'] > 10000
      || typeof line['expectedUnitPricePaise'] !== 'number' || !Number.isSafeInteger(line['expectedUnitPricePaise']) || line['expectedUnitPricePaise'] < 0 || line['expectedUnitPricePaise'] > 100000000) return false;
    const id = line['productId'].toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true;
  });
}
export function loadCustomerOrder(storage: Storage, slug: string, customer: string): SaasCustomerSubmit | null {
  const raw = storage.getItem(keyOf(slug, customer)); if (raw === null) return null;
  if (raw.length > 50000) throw new Error('Invalid customer recovery record'); const saved: unknown = JSON.parse(raw);
  if (!record(saved) || Object.keys(saved).sort().join(',') !== 'customer,input,slug,version' || saved['version'] !== 1 || saved['slug'] !== slug || saved['customer'] !== customer.toLowerCase() || !valid(saved['input'])) throw new Error('Invalid customer recovery record');
  return saved['input'];
}
export function saveCustomerOrder(storage: Storage, slug: string, customer: string, input: SaasCustomerSubmit) {
  if (!valid(input)) throw new Error('Invalid pickup order'); const key = keyOf(slug, customer), value = JSON.stringify({ version: 1, slug, customer: customer.toLowerCase(), input });
  if (value.length > 50000) throw new Error('Customer order exceeds recovery limits'); const previous = storage.getItem(key);
  if (previous !== null && previous !== value) throw new Error('Resolve the earlier pickup order first');
  storage.setItem(key, value); if (storage.getItem(key) !== value) throw new Error('Pickup order recovery did not retain the request');
}
export function clearCustomerOrder(storage: Storage, slug: string, customer: string, key: string) {
  const saved = loadCustomerOrder(storage, slug, customer); if (saved && saved.idempotencyKey !== key) throw new Error('A different pickup order cannot be cleared');
  const storageKey = keyOf(slug, customer); storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) throw new Error('Could not clear pickup recovery');
}
