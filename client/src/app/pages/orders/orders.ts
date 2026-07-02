import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../../core/services/order.service';
import { Order, OrderItem, OrderStatus } from '../../core/models/order.model';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { foodImage } from '../../core/utils/food-image';

/** Max circular thumbnails per order card; the rest collapse into a “+N” chip. */
const MAX_THUMBS = 4;

@Component({
  selector: 'app-orders',
  imports: [RouterLink, DatePipe, RevealOnScroll],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class Orders {
  private orderService = inject(OrderService);

  protected readonly orders = signal<Order[]>([]);
  protected readonly loading = signal(true);

  constructor() {
    this.orderService.myOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  itemsSummary(order: Order): string {
    return order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
  }

  /** Presentation only — real photos for the overlapping thumbnail row. */
  thumbs(order: Order): { name: string; image: string }[] {
    return order.items
      .slice(0, MAX_THUMBS)
      .map((item) => ({ name: item.name, image: this.itemImage(item) }));
  }

  /** How many line items didn’t fit in the thumbnail row. */
  extraCount(order: Order): number {
    return Math.max(0, order.items.length - MAX_THUMBS);
  }

  /** Maps an order status to its pill tone: gold = in flight, success = done, danger = cancelled. */
  statusTone(status: OrderStatus): 'gold' | 'success' | 'danger' {
    if (status === 'completed') return 'success';
    if (status === 'cancelled') return 'danger';
    return 'gold';
  }

  /** Resolves a curated photo for a line item by slugifying its name. */
  private itemImage(item: OrderItem): string {
    const slug = item.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return foodImage({ slug, category: '' });
  }
}
