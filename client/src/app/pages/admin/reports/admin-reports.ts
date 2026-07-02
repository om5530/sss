import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ProductReport, SalesReport } from '../../../core/models/admin.model';
import { downloadCsv } from '../shared/admin-ui';

type Preset = 'today' | '7d' | '30d' | 'month';

/** Local calendar date as YYYY-MM-DD (the store runs on IST). */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-admin-reports',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './admin-reports.html',
})
export class AdminReports {
  private admin = inject(AdminService);

  protected readonly sales = signal<SalesReport | null>(null);
  protected readonly products = signal<ProductReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly preset = signal<Preset | null>('30d');

  protected from = '';
  protected to = '';
  protected granularity: 'day' | 'week' | 'month' = 'day';

  /** Bars scaled to the busiest period; labels shown on hover + in the table. */
  protected readonly bars = computed(() => {
    const rows = this.sales()?.rows ?? [];
    const max = Math.max(1, ...rows.map((r) => r.revenue));
    const labelStep = Math.max(1, Math.ceil(rows.length / 10));
    return rows.map((r, i) => ({
      ...r,
      pct: (r.revenue / max) * 100,
      xLabel: i % labelStep === 0 ? r.period.slice(this.granularity === 'day' ? 5 : 0) : '',
    }));
  });

  protected readonly maxCategory = computed(() =>
    Math.max(1, ...(this.products()?.byCategory ?? []).map((c) => c.revenue)),
  );
  protected readonly maxType = computed(() =>
    Math.max(1, ...(this.products()?.byType ?? []).map((t) => t.revenue)),
  );

  constructor() {
    this.applyPreset('30d');
  }

  protected applyPreset(preset: Preset) {
    const today = new Date();
    const start = new Date(today);
    if (preset === '7d') start.setDate(today.getDate() - 6);
    if (preset === '30d') start.setDate(today.getDate() - 29);
    if (preset === 'month') start.setDate(1);
    this.from = isoDate(start);
    this.to = isoDate(today);
    this.preset.set(preset);
    this.fetch();
  }

  protected onCustomRange() {
    if (!this.from || !this.to) return;
    this.preset.set(null);
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    const range = { from: this.from, to: this.to };
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (!pending) this.loading.set(false);
    };
    this.admin.salesReport({ ...range, granularity: this.granularity }).subscribe({
      next: (sales) => {
        this.sales.set(sales);
        done();
      },
      error: done,
    });
    this.admin.productReport(range).subscribe({
      next: (products) => {
        this.products.set(products);
        done();
      },
      error: done,
    });
  }

  exportSales() {
    const s = this.sales();
    if (!s) return;
    downloadCsv(
      `sales_${this.from}_to_${this.to}.csv`,
      ['Period', 'Orders', 'Revenue (INR)', 'Avg order value (INR)'],
      s.rows.map((r) => [r.period, r.orders, r.revenue, r.avgOrderValue]),
    );
  }

  exportProducts() {
    const p = this.products();
    if (!p) return;
    downloadCsv(
      `products_${this.from}_to_${this.to}.csv`,
      ['Product', 'Category', 'Quantity sold', 'Revenue (INR)'],
      p.topProducts.map((r) => [r.name, r.category, r.quantity, r.revenue]),
    );
  }
}
