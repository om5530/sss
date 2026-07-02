const env = require('../config/env');
const User = require('../models/User');

const BRAND = 'Sweet Savory Savor';

/** Best-effort lookup of the customer email for an order (guests have none). */
async function emailForOrder(order) {
  if (!order.user) return null;
  try {
    const user = await User.findById(order.user).select('email');
    return user?.email || null;
  } catch {
    return null;
  }
}

/**
 * Email notifications via Resend's REST API. With no RESEND_API_KEY the
 * service logs instead of sending, so every hook is safe to call in dev.
 * All sends are fire-and-forget: a notification failure must never fail
 * the order/enquiry that triggered it (same contract as audit.service).
 */
async function sendEmail({ to, subject, html }) {
  if (!to) return;
  if (!env.notify.resendApiKey) {
    console.log(`[notify:mock] → ${to} · ${subject}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.notify.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.notify.from, to, subject, html }),
    });
    if (!res.ok) console.error('[notify] send failed:', res.status, await res.text());
  } catch (err) {
    console.error('[notify] send failed:', err.message);
  }
}

/* ---------------- Templates (simple, inline, email-client-safe) ---------------- */

const wrap = (title, bodyHtml) => `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #3a2a20;">
    <h2 style="color: #7a4a21; margin-bottom: 4px;">${BRAND}</h2>
    <h3 style="margin-top: 0;">${title}</h3>
    ${bodyHtml}
    <p style="color: #9a8a7d; font-size: 12px; margin-top: 28px;">Baked fresh · Served warm · Loved daily</p>
  </div>`;

const itemsTable = (order) => `
  <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
    ${order.items
      .map(
        (i) =>
          `<tr><td style="padding: 4px 0;">${i.quantity}× ${i.name}</td><td style="text-align: right;">₹${i.lineTotal.toFixed(2)}</td></tr>`,
      )
      .join('')}
    ${order.pricing.discount ? `<tr><td style="padding: 4px 0;">Discount${order.pricing.couponCode ? ` (${order.pricing.couponCode})` : ''}</td><td style="text-align: right;">−₹${order.pricing.discount.toFixed(2)}</td></tr>` : ''}
    <tr><td style="padding: 8px 0; font-weight: bold; border-top: 1px solid #e8ddd2;">Total</td><td style="text-align: right; font-weight: bold; border-top: 1px solid #e8ddd2;">₹${order.pricing.total.toFixed(2)}</td></tr>
  </table>`;

const STATUS_COPY = {
  confirmed: { subject: 'Order confirmed', line: 'Our bakers have your ticket — it’s heading for the oven.' },
  preparing: { subject: 'Your order is being prepared', line: 'It’s in the oven right now.' },
  ready: { subject: 'Your order is ready!', line: 'Boxed, warm, and waiting for you.' },
  completed: { subject: 'Order completed', line: 'Hope every bite was worth it — see you again soon.' },
  cancelled: { subject: 'Order cancelled', line: 'This order has been cancelled. If it was already paid, the refund follows separately.' },
};

/** Customer + shop alert on a new order. */
function notifyOrderPlaced(order, customerEmail) {
  void sendEmail({
    to: customerEmail,
    subject: `${BRAND} — order ${order.orderNumber} received`,
    html: wrap(`Order ${order.orderNumber} received`, `<p>Thanks! We’ve got your ${order.orderType} order.</p>${itemsTable(order)}`),
  });
  void sendEmail({
    to: env.notify.shopEmail,
    subject: `New ${order.orderType} order ${order.orderNumber} — ₹${order.pricing.total.toFixed(2)}`,
    html: wrap(`New order ${order.orderNumber}`, itemsTable(order)),
  });
}

/** Customer update when the order moves through its lifecycle. */
function notifyOrderStatus(order, status, customerEmail) {
  const copy = STATUS_COPY[status];
  if (!copy) return;
  void sendEmail({
    to: customerEmail,
    subject: `${BRAND} — ${copy.subject} (${order.orderNumber})`,
    html: wrap(copy.subject, `<p>${copy.line}</p><p>Order <strong>${order.orderNumber}</strong> · ₹${order.pricing.total.toFixed(2)}</p>`),
  });
}

function notifyRefund(order, customerEmail) {
  void sendEmail({
    to: customerEmail,
    subject: `${BRAND} — refund issued for ${order.orderNumber}`,
    html: wrap('Refund issued', `<p>₹${order.pricing.total.toFixed(2)} for order <strong>${order.orderNumber}</strong> is on its way back to you.</p>`),
  });
}

/** Shop alert for a contact-form enquiry. */
function notifyEnquiry(message) {
  void sendEmail({
    to: env.notify.shopEmail,
    subject: `New enquiry from ${message.name}`,
    html: wrap('New enquiry', `<p><strong>${message.name}</strong> &lt;${message.email}&gt;</p><p style="white-space: pre-line;">${message.message}</p>`),
  });
}

/** Shop alert for a custom-cake request. */
function notifyCakeRequest(request) {
  void sendEmail({
    to: env.notify.shopEmail,
    subject: `Custom cake request — ${request.occasion} on ${request.dateNeeded ? new Date(request.dateNeeded).toDateString() : 'TBD'}`,
    html: wrap(
      'Custom cake request',
      `<p><strong>${request.name}</strong> · ${request.phone}${request.email ? ` · ${request.email}` : ''}</p>
       <p>${request.occasion} · serves ~${request.servings} · ${request.flavour}</p>
       ${request.messageOnCake ? `<p>On the cake: “${request.messageOnCake}”</p>` : ''}
       <p style="white-space: pre-line;">${request.details || ''}</p>
       ${request.referenceImage ? `<p>Reference: ${request.referenceImage}</p>` : ''}`,
    ),
  });
}

module.exports = { sendEmail, emailForOrder, notifyOrderPlaced, notifyOrderStatus, notifyRefund, notifyEnquiry, notifyCakeRequest };
