import { Component, computed, input } from '@angular/core';
import { ORDER_FLOW, Order, OrderStatus } from '../../../core/models/order.model';

@Component({
  selector: 'app-status-tracker',
  templateUrl: './status-tracker.html',
  styleUrl: './status-tracker.scss',
})
export class StatusTracker {
  readonly order = input.required<Order>();

  protected readonly flow: OrderStatus[] = ORDER_FLOW;
  protected readonly labels: Record<OrderStatus, string> = {
    placed: 'Placed',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  protected readonly cancelled = computed(() => this.order().orderStatus === 'cancelled');
  protected readonly currentIndex = computed(() => ORDER_FLOW.indexOf(this.order().orderStatus));
  /** Presentation only — the rail settles (no pulse) once the order completes. */
  protected readonly complete = computed(() => this.order().orderStatus === 'completed');

  isDone(index: number): boolean {
    return index <= this.currentIndex();
  }
}
