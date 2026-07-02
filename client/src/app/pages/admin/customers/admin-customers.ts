import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { CustomerRow } from '../../../core/models/admin.model';

@Component({
  selector: 'app-admin-customers',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './admin-customers.html',
})
export class AdminCustomers {
  private admin = inject(AdminService);

  protected readonly customers = signal<CustomerRow[]>([]);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);

  protected q = '';
  protected page = 1;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.fetch();
  }

  protected onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.fetch();
    }, 350);
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.customers({ q: this.q || undefined, page: this.page }).subscribe({
      next: (res) => {
        this.customers.set(res.customers);
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
