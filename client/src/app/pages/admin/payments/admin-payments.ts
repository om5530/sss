import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { AdminPayment } from '../../../core/models/admin.model';

/** Payment-record statuses → badge tones (order badges reuse paymentStatus). */
const PAYMENT_BADGE: Record<AdminPayment['status'], string> = {
  succeeded: 'paid',
  requires_payment: 'pending',
  processing: 'pending',
  failed: 'failed',
  refunded: 'refunded',
};

@Component({
  selector: 'app-admin-payments',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './admin-payments.html',
})
export class AdminPayments {
  private admin = inject(AdminService);

  protected readonly payments = signal<AdminPayment[]>([]);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);

  protected status = '';
  protected page = 1;

  constructor() {
    this.fetch();
  }

  protected badge(p: AdminPayment): string {
    return `adm-badge adm-badge--${PAYMENT_BADGE[p.status]}`;
  }

  protected statusLabel(p: AdminPayment): string {
    return p.status.replace('_', ' ');
  }

  /** Redirect said paid but the webhook never confirmed — needs a look (AS-7.1). */
  protected needsAttention(p: AdminPayment): boolean {
    return !p.mock && p.status !== 'succeeded' && p.status !== 'refunded' && p.order?.paymentStatus === 'paid';
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.payments({ status: this.status || undefined, page: this.page }).subscribe({
      next: (res) => {
        this.payments.set(res.payments);
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
