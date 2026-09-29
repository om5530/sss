import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService } from '../../../core/services/admin.service';
import { EventSalesReport } from '../../../core/models/admin.model';
import { downloadCsv } from '../shared/admin-ui';

@Component({ selector: 'app-admin-events', imports: [RouterLink, FormsModule, DatePipe, DecimalPipe], templateUrl: './admin-events.html' })
export class AdminEvents {
  private admin = inject(AdminService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private version = 0;
  protected readonly report = signal<EventSalesReport | null>(null);
  protected readonly names = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected eventName = this.route.snapshot.queryParamMap.get('eventName') || '';

  constructor() { this.load(); }

  protected load() {
    const version = ++this.version;
    this.loading.set(true); this.failed.set(false);
    this.admin.eventSales().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (all) => {
        if (version !== this.version) return;
        this.names.set(all.events.map((e) => e.eventName));
        if (!this.eventName) { this.report.set(all); this.loading.set(false); return; }
        this.admin.eventSales(this.eventName).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (report) => { if (version === this.version) { this.report.set(report); this.loading.set(false); } },
          error: () => { if (version === this.version) { this.failed.set(true); this.loading.set(false); } },
        });
      },
      error: () => { if (version === this.version) { this.failed.set(true); this.loading.set(false); } },
    });
  }

  protected apply() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { eventName: this.eventName || null }, replaceUrl: true });
    this.load();
  }

  protected sum(field: 'revenue' | 'units' | 'pendingAmount' | 'paidOrders') {
    return this.report()?.events.reduce((total, event) => total + event[field], 0) || 0;
  }

  protected export() {
    downloadCsv('event-sales.csv', ['Event', 'Orders', 'Paid orders', 'Units sold', 'Sales INR', 'Cash INR', 'UPI INR', 'Card INR', 'Unpaid INR'],
      (this.report()?.events || []).map((e) => [e.eventName, e.orders, e.paidOrders, e.units, e.revenue, e.cash, e.upi, e.card, e.pendingAmount]));
  }
}
