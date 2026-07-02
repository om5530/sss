import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrderService } from '../../core/services/order.service';
import { PaymentFlowService } from '../../core/services/payment-flow.service';
import { ToastService } from '../../core/services/toast.service';
import { Order } from '../../core/models/order.model';
import { StatusTracker } from '../../shared/components/status-tracker/status-tracker';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { foodImage } from '../../core/utils/food-image';

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, DatePipe, StatusTracker, RevealOnScroll],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetail {
  readonly id = input.required<string>();

  private orders = inject(OrderService);
  private payments = inject(PaymentFlowService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  protected readonly order = signal<Order | null>(null);
  protected readonly loading = signal(true);
  protected readonly paying = signal(false);

  /** Online order still awaiting payment (or a failed attempt) — offer to complete it here. */
  protected readonly canPayNow = computed(() => {
    const o = this.order();
    return (
      !!o &&
      o.paymentMethod !== 'cash' &&
      (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') &&
      o.orderStatus !== 'cancelled' &&
      o.orderStatus !== 'completed'
    );
  });

  /** Presentation only — tone of the hero status pill. */
  protected readonly statusTone = computed(() => {
    const status = this.order()?.orderStatus;
    if (status === 'cancelled') return 'danger';
    if (status === 'completed') return 'done';
    return 'live';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.loading.set(true);
      this.orders.get(id).subscribe({
        next: (order) => {
          this.order.set(order);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    });
  }

  /** Retry an unfinished online payment (popup dismissed at checkout, etc.). */
  completePayment(): void {
    const o = this.order();
    if (!o || this.paying()) return;
    this.paying.set(true);

    const user = this.auth.user();
    const prefill = {
      name: o.takeaway?.customerName || o.dining?.customerName || user?.name || undefined,
      contact: o.takeaway?.phone || user?.phone || undefined,
      email: user?.email || undefined,
    };

    this.payments
      .payOnline(o._id, prefill)
      .then((result) => {
        this.paying.set(false);
        if (result === 'paid') this.toast.success('Payment received — thank you!');
        else if (result === 'failed') this.toast.error('We could not verify that payment — if you were charged, it will reconcile shortly.');
        else this.toast.info('Payment not completed — you can try again here, or pay when you receive your order.');
        // Refresh regardless; the webhook may have settled it server-side.
        this.orders.get(o._id).subscribe({ next: (order) => this.order.set(order) });
      })
      .catch((err: { error?: { message?: string } }) => {
        this.paying.set(false);
        this.toast.error(err.error?.message || 'Could not start the payment — please try again.');
      });
  }

  /** Payment pill copy — cash orders aren't "pending", they're pay-on-hand-over. */
  protected payChip(o: Order): string {
    if (o.paymentStatus === 'paid') return 'Paid';
    if (o.paymentMethod === 'cash' && o.paymentStatus === 'pending') {
      if (o.orderType === 'delivery') return 'Cash on delivery';
      if (o.orderType === 'dining') return 'Pay at the counter';
      return 'Pay at pickup';
    }
    return 'Payment ' + o.paymentStatus;
  }

  /** Presentation only — real product photo for an order line, resolved by name-slug. */
  protected itemImage(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return foodImage({ slug, category: '' });
  }
}
