import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { CustomerDetail } from '../../../core/models/admin.model';
import { badgeClass } from '../shared/admin-ui';

@Component({
  selector: 'app-admin-customer-detail',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './admin-customer-detail.html',
})
export class AdminCustomerDetail {
  readonly id = input.required<string>();

  private admin = inject(AdminService);

  protected readonly detail = signal<CustomerDetail | null>(null);
  protected readonly loading = signal(true);

  protected readonly badgeClass = badgeClass;

  constructor() {
    effect(() => {
      const id = this.id();
      this.loading.set(true);
      this.admin.customer(id).subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    });
  }
}
