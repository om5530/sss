import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { AdminOrder, OrderFilters } from '../../../core/models/admin.model';
import { badgeClass, orderCustomer } from '../shared/admin-ui';

@Component({
  selector: 'app-admin-orders',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './admin-orders.html',
})
export class AdminOrders {
  private admin = inject(AdminService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly orders = signal<AdminOrder[]>([]);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);

  // Filters live in the URL so a filtered view can be shared (AS-3.1).
  protected q = '';
  protected status = '';
  protected type = '';
  protected payment = '';
  protected from = '';
  protected to = '';
  protected page = 1;

  protected readonly badgeClass = badgeClass;
  protected readonly orderCustomer = orderCustomer;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    this.q = params.get('q') ?? '';
    this.status = params.get('status') ?? '';
    this.type = params.get('type') ?? '';
    this.payment = params.get('payment') ?? '';
    this.from = params.get('from') ?? '';
    this.to = params.get('to') ?? '';
    this.page = Math.max(1, Number(params.get('page')) || 1);
    this.fetch();
  }

  protected apply(resetPage = true) {
    if (resetPage) this.page = 1;
    const queryParams: Record<string, string | number | null> = {
      q: this.q || null,
      status: this.status || null,
      type: this.type || null,
      payment: this.payment || null,
      from: this.from || null,
      to: this.to || null,
      page: this.page > 1 ? this.page : null,
    };
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
    this.fetch();
  }

  protected onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.apply(), 350);
  }

  protected clearFilters() {
    this.q = this.status = this.type = this.payment = this.from = this.to = '';
    this.apply();
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.apply(false);
  }

  protected get hasFilters(): boolean {
    return Boolean(this.q || this.status || this.type || this.payment || this.from || this.to);
  }

  private fetch() {
    this.loading.set(true);
    const filters: OrderFilters = {
      q: this.q || undefined,
      status: (this.status as OrderFilters['status']) || undefined,
      type: (this.type as OrderFilters['type']) || undefined,
      payment: (this.payment as OrderFilters['payment']) || undefined,
      from: this.from || undefined,
      to: this.to || undefined,
      page: this.page,
    };
    this.admin.orders(filters).subscribe({
      next: (res) => {
        this.orders.set(res.orders);
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
