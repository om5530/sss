import type { CartQuote } from '../models/cart.model';

/** WhatsApp requires digits in international format. Local Indian mobiles use +91. */
export function whatsappNumber(phone: string): string | null {
  let number = phone.trim().replace(/[\s().-]/g, '');
  const international = number.startsWith('+') || number.startsWith('00');
  if (number.startsWith('+')) number = number.slice(1);
  else if (number.startsWith('00')) number = number.slice(2);
  if (!international && /^0?[6-9]\d{9}$/.test(number)) number = '91' + number.replace(/^0/, '');
  return /^[1-9]\d{7,14}$/.test(number) ? number : null;
}

export function whatsappChatUrl(phone: string, message = ''): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}${message ? '?text=' + encodeURIComponent(message) : ''}` : null;
}

/** Uses the server quote, including current product prices and rounded totals. */
export function whatsappOrderMessage(quote: CartQuote): string {
  const money = (amount: number) => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: quote.pricing.currency.toUpperCase(), minimumFractionDigits: 2,
  }).format(amount);
  const lines = quote.items.map((item) => `• ${item.name.replace(/[\r\n]+/g, ' ')} × ${item.quantity} — ${money(item.lineTotal)}`);
  const totals = [`Subtotal: ${money(quote.pricing.subtotal)}`];
  if (quote.pricing.discount) totals.push(`Discount: −${money(quote.pricing.discount)}`);
  if (quote.pricing.tax) totals.push(`Tax: ${money(quote.pricing.tax)}`);
  if (quote.pricing.deliveryFee) totals.push(`Delivery: ${money(quote.pricing.deliveryFee)}`);
  totals.push(`*Estimated total: ${money(quote.pricing.total)}*`);
  return ["Hello The Golden Batch, I'd like to place an order:", '', ...lines, '', ...totals, '',
    'Could you please confirm availability, pickup or delivery, and payment details?',
    'Any additional delivery charge and timing can be confirmed here.'].join('\n');
}
