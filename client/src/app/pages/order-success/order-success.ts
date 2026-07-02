import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { StatusTracker } from '../../shared/components/status-tracker/status-tracker';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { Magnetic } from '../../shared/directives/magnetic.directive';

@Component({
  selector: 'app-order-success',
  imports: [RouterLink, DatePipe, StatusTracker, RevealOnScroll, Magnetic],
  templateUrl: './order-success.html',
  styleUrl: './order-success.scss',
})
export class OrderSuccess {
  // Bound from the :id route param (withComponentInputBinding).
  readonly id = input.required<string>();

  private orders = inject(OrderService);
  protected readonly order = signal<Order | null>(null);
  protected readonly loading = signal(true);

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

    // Live status: refresh every 15 s while the kitchen is still working on it.
    const timer = setInterval(() => {
      const o = this.order();
      if (!o || document.hidden) return;
      if (!['placed', 'confirmed', 'preparing', 'ready'].includes(o.orderStatus)) return;
      this.orders.get(this.id()).subscribe({ next: (order) => this.order.set(order) });
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Payment chip copy — cash orders aren't "pending", they're pay-on-hand-over. */
  protected payChip(o: Order): string {
    if (o.paymentStatus === 'paid') return 'Paid';
    if (o.paymentMethod === 'cash' && o.paymentStatus === 'pending') {
      if (o.orderType === 'delivery') return 'Cash on delivery';
      if (o.orderType === 'dining') return 'Pay at the counter';
      return 'Pay at pickup';
    }
    return 'Payment ' + o.paymentStatus;
  }
}
