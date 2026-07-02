import { AdminOrder } from '../../../core/models/admin.model';
import { OrderStatus } from '../../../core/models/order.model';

/** Next legal forward move per lifecycle stage (mirrors the server's map). */
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

/** One-tap action labels for the queue (AS-2.3). */
export const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  placed: 'Confirm',
  confirmed: 'Start preparing',
  preparing: 'Mark ready',
  ready: 'Complete',
};

export function badgeClass(value: string): string {
  return `adm-badge adm-badge--${value}`;
}

/** Who to show for an order — account holder, walk-in name, or Guest. */
export function orderCustomer(order: AdminOrder): string {
  return (
    order.user?.name ||
    order.user?.phone ||
    order.takeaway?.customerName ||
    order.dining?.customerName ||
    'Guest'
  );
}

/** Compact "how long ago" for queue cards: 4m · 1h 12m. */
export function elapsed(since: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

export function elapsedMinutes(since: string): number {
  return Math.floor((Date.now() - new Date(since).getTime()) / 60000);
}

export function itemsSummary(order: AdminOrder): string {
  return order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
}

/** Client-side CSV export (AS-8.3): what's on screen is what downloads. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
