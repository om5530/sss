import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { DashboardStats } from '../../../core/models/admin.model';
import { badgeClass, orderCustomer } from '../shared/admin-ui';

const REFRESH_MS = 60_000;

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard {
  private admin = inject(AdminService);

  protected readonly stats = signal<DashboardStats | null>(null);
  protected readonly loading = signal(true);

  protected readonly badgeClass = badgeClass;
  protected readonly orderCustomer = orderCustomer;

  protected readonly queueTotal = computed(() => {
    const s = this.stats();
    return s ? Object.values(s.activeByStatus).reduce((a, b) => a + b, 0) : 0;
  });

  /** Order-type split as single-hue magnitude bars. */
  protected readonly typeRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const rows = [
      { label: 'Dine-in', value: s.typeSplit.dining },
      { label: 'Takeaway', value: s.typeSplit.takeaway },
      { label: 'Delivery', value: s.typeSplit.delivery },
    ];
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.map((r) => ({ ...r, pct: (r.value / max) * 100 }));
  });

  protected readonly queueStages = computed(() => {
    const s = this.stats();
    if (!s) return [];
    return (['placed', 'confirmed', 'preparing', 'ready'] as const).map((stage) => ({
      stage,
      count: s.activeByStatus[stage] ?? 0,
    }));
  });

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(true), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected load(silent = false) {
    if (!silent) this.loading.set(true);
    this.admin.dashboard().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
