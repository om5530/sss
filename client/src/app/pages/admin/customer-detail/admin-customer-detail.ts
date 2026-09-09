import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { CustomerDetail } from '../../../core/models/admin.model';
import { badgeClass } from '../shared/admin-ui';
import { ConfirmModal } from '../shared/confirm-modal';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-admin-customer-detail',
  imports: [RouterLink, DatePipe, DecimalPipe, ConfirmModal],
  templateUrl: './admin-customer-detail.html',
})
export class AdminCustomerDetail {
  readonly id = input.required<string>();

  private admin = inject(AdminService);
  private toast = inject(ToastService);
  protected confirming = signal(false);
  protected busy = signal(false);
  changeStatus(reason: string) {
    const detail = this.detail();
    if (!detail || this.busy()) return;
    const active = detail.customer.active === false;
    this.busy.set(true);
    this.admin.setCustomerActive(this.id(), active, reason).subscribe({
      next: () => {
        this.detail.set({ ...detail, customer: { ...detail.customer, active } });
        this.busy.set(false); this.confirming.set(false);
        this.toast.success(active ? 'Customer account reactivated.' : 'Customer account deactivated.');
      },
      error: (err) => { this.busy.set(false); this.toast.error(err.error?.message || 'Could not update this account.'); },
    });
  }

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
