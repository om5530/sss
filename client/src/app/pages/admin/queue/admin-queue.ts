import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminOrder } from '../../../core/models/admin.model';
import { OrderStatus } from '../../../core/models/order.model';
import { ConfirmModal } from '../shared/confirm-modal';
import { NEXT_LABEL, NEXT_STATUS, elapsed, elapsedMinutes, itemsSummary, orderCustomer } from '../shared/admin-ui';

const POLL_MS = 8_000;
const MUTE_KEY = 'adm_queue_muted';
/** A placed/confirmed order older than this is flagged as running late. */
const LATE_MINUTES = 20;

const STAGES: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'ready'];

@Component({
  selector: 'app-admin-queue',
  imports: [ConfirmModal],
  templateUrl: './admin-queue.html',
})
export class AdminQueue {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly loading = signal(true);
  protected readonly offline = signal(false);
  protected readonly muted = signal(localStorage.getItem(MUTE_KEY) === 'true');
  protected readonly newIds = signal<Set<string>>(new Set());
  protected readonly cancelTarget = signal<AdminOrder | null>(null);
  protected readonly busyId = signal<string | null>(null);

  protected readonly stages = STAGES;
  protected readonly nextLabel = NEXT_LABEL;
  protected readonly elapsed = elapsed;
  protected readonly itemsSummary = itemsSummary;
  protected readonly orderCustomer = orderCustomer;

  private knownIds: Set<string> | null = null;

  protected readonly columns = computed(() => {
    const grouped = new Map<OrderStatus, AdminOrder[]>(STAGES.map((s) => [s, []]));
    for (const order of this.orders()) grouped.get(order.orderStatus)?.push(order);
    return STAGES.map((stage) => ({ stage, orders: grouped.get(stage)! }));
  });

  constructor() {
    this.poll();
    const timer = setInterval(() => this.poll(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private poll() {
    this.admin.orders({ active: true, limit: 100 }).subscribe({
      next: (res) => {
        // Anything we haven't seen before gets a highlight + chime (AS-2.2).
        const incoming = res.orders.filter((o) => this.knownIds && !this.knownIds.has(o._id));
        if (incoming.length) {
          this.newIds.set(new Set(incoming.map((o) => o._id)));
          if (!this.muted()) this.chime();
        }
        this.knownIds = new Set(res.orders.map((o) => o._id));
        this.orders.set(res.orders);
        this.loading.set(false);
        this.offline.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.offline.set(true);
      },
    });
  }

  /** One-tap advance (AS-2.3) — optimistic move, reverted on failure. */
  advance(order: AdminOrder) {
    const next = NEXT_STATUS[order.orderStatus];
    if (!next || this.busyId()) return;

    const previous = this.orders();
    this.busyId.set(order._id);
    this.orders.update((list) =>
      next === 'completed'
        ? list.filter((o) => o._id !== order._id)
        : list.map((o) => (o._id === order._id ? { ...o, orderStatus: next } : o)),
    );

    this.admin.updateOrderStatus(order._id, next).subscribe({
      next: () => this.busyId.set(null),
      error: (err) => {
        this.orders.set(previous);
        this.busyId.set(null);
        this.toast.error(err.error?.message || 'Could not update the order — try again.');
      },
    });
  }

  cancel(reason: string) {
    const order = this.cancelTarget();
    if (!order) return;
    this.busyId.set(order._id);
    this.admin.updateOrderStatus(order._id, 'cancelled', reason).subscribe({
      next: () => {
        this.busyId.set(null);
        this.cancelTarget.set(null);
        this.orders.update((list) => list.filter((o) => o._id !== order._id));
        this.toast.success(`${order.orderNumber} cancelled.`);
      },
      error: (err) => {
        this.busyId.set(null);
        this.toast.error(err.error?.message || 'Could not cancel the order.');
      },
    });
  }

  toggleMute() {
    this.muted.update((m) => !m);
    localStorage.setItem(MUTE_KEY, String(this.muted()));
  }

  isLate(order: AdminOrder): boolean {
    if (order.orderStatus !== 'placed' && order.orderStatus !== 'confirmed') return false;
    // Scheduled pre-orders only run late once their promised time arrives —
    // creation age means nothing for tomorrow's pickup.
    if (order.fulfilAt) return Date.now() >= new Date(order.fulfilAt).getTime();
    return elapsedMinutes(order.createdAt) >= LATE_MINUTES;
  }

  /** "6:30 pm" today, or "Sat 6:30 pm" for another day. */
  scheduledLabel(iso: string): string {
    const d = new Date(iso);
    const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${time}`;
  }

  fulfilment(order: AdminOrder): string {
    if (order.orderType === 'dining') return order.dining?.tableNumber ? `Table ${order.dining.tableNumber}` : 'Dine-in';
    if (order.orderType === 'takeaway') return order.takeaway?.phone || 'Takeaway';
    return [order.delivery?.area, order.delivery?.city].filter(Boolean).join(', ') || 'Delivery';
  }

  /** Two-tone counter bell — no audio asset needed. Autoplay rules may block
   *  it before the first interaction; that's fine, the highlight still shows. */
  private chime() {
    try {
      const ctx = new AudioContext();
      const note = (freq: number, at: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.55);
      };
      note(880, 0);
      note(1174, 0.15);
      setTimeout(() => ctx.close(), 1200);
    } catch {
      /* no audio available — the visual highlight is enough */
    }
  }
}
