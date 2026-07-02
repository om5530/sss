import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { AdminOrder } from '../../../core/models/admin.model';

export interface PrepItem {
  _id: string;
  name: string;
  quantity: number;
  orders: number;
}

/**
 * The kitchen's morning answer to "what do we bake?": every active order plus
 * today's scheduled pre-orders, aggregated per product. Built to be printed.
 */
@Component({
  selector: 'app-admin-prep',
  imports: [DatePipe],
  templateUrl: './admin-prep.html',
})
export class AdminPrep {
  private admin = inject(AdminService);

  protected readonly items = signal<PrepItem[]>([]);
  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly generatedAt = signal<string>('');
  protected readonly loading = signal(true);

  constructor() {
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.prepSheet().subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.orders.set(res.orders);
        this.generatedAt.set(res.generatedAt);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected totalUnits(): number {
    return this.items().reduce((n, i) => n + i.quantity, 0);
  }

  protected who(o: AdminOrder): string {
    if (o.orderType === 'dining') return o.dining?.tableNumber ? `Table ${o.dining.tableNumber}` : o.dining?.customerName || 'Dine-in';
    if (o.orderType === 'takeaway') return o.takeaway?.customerName || 'Takeaway';
    return o.delivery?.area || 'Delivery';
  }

  protected itemsLine(o: AdminOrder): string {
    return o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
  }

  print() {
    window.print();
  }
}
