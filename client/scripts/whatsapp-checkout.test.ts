import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappNumber, whatsappChatUrl, whatsappOrderMessage } from '../src/app/core/utils/whatsapp.ts';
import type { CartQuote } from '../src/app/core/models/cart.model.ts';

const quote: CartQuote = {
  items: [
    { product: 'a', name: 'Classic Tiramisu & Coffee #1', price: 219, quantity: 2, lineTotal: 438 },
    { product: 'b', name: 'Brownie 🧁', price: 119, quantity: 1, lineTotal: 119 },
  ],
  pricing: { subtotal: 557, tax: 27.85, deliveryFee: 0, total: 584.85, currency: 'inr', taxRate: .05 },
};

test('Indian business contacts and explicit international contacts reach the correct WhatsApp number', () => {
  for (const phone of ['9623838707', '09623838707', '+91 (96238) 38707', '0091-96238-38707', '919623838707']) {
    assert.equal(whatsappNumber(phone), '919623838707');
  }
  assert.equal(whatsappNumber('+44 20 7946 0958'), '442079460958');
  for (const phone of ['', '0000', '123', '9623838707 ext 12', 'javascript:9623838707', '+91 96238&38707']) {
    assert.equal(whatsappChatUrl(phone, 'Order request'), null);
  }
});

test('order messages preserve server-priced quantities, rounded line totals and tax', () => {
  const message = whatsappOrderMessage(quote);
  assert.ok(message.includes('Classic Tiramisu & Coffee #1 × 2 — ₹438.00'));
  assert.ok(message.includes('Brownie 🧁 × 1 — ₹119.00'));
  assert.ok(message.includes('Subtotal: ₹557.00'));
  assert.ok(message.includes('Tax: ₹27.85'));
  assert.ok(message.includes('*Estimated total: ₹584.85*'));
  assert.ok(message.includes('confirm availability, pickup or delivery, and payment details'));
});

test('special characters, rupees, emoji and newlines are encoded without changing the recipient or adding query parameters', () => {
  const message = whatsappOrderMessage(quote);
  const url = new URL(whatsappChatUrl('+91 96238 38707', message)!);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/919623838707');
  assert.equal(url.searchParams.get('text'), message);
  assert.deepEqual([...url.searchParams.keys()], ['text']);
  assert.equal(url.hash, '');
});

test('discount and delivery charges use the quoted total and product-name line breaks cannot change the message layout', () => {
  const changed: CartQuote = { items: [{ ...quote.items[0], name: 'Tiramisu\nNew line' }],
    pricing: { ...quote.pricing, subtotal: 438, discount: 38, tax: 20, deliveryFee: 40, total: 460 } };
  const message = whatsappOrderMessage(changed);
  assert.ok(message.includes('Tiramisu New line × 2'));
  assert.ok(message.includes('Discount: −₹38.00'));
  assert.ok(message.includes('Delivery: ₹40.00'));
  assert.ok(message.includes('*Estimated total: ₹460.00*'));
});
