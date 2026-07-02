import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { CakeRequest, CakeRequestStatus } from '../../../core/models/admin.model';

/** Cake statuses → existing badge tones. */
const CAKE_BADGE: Record<CakeRequestStatus, string> = {
  new: 'pending',
  quoted: 'confirmed',
  accepted: 'paid',
  declined: 'failed',
  closed: 'mock',
};

@Component({
  selector: 'app-admin-cake-requests',
  imports: [FormsModule, DatePipe],
  templateUrl: './admin-cake-requests.html',
})
export class AdminCakeRequests {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly requests = signal<CakeRequest[]>([]);
  protected readonly total = signal(0);
  protected readonly newCount = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  /** Row currently expanded for quoting. */
  protected readonly openId = signal<string | null>(null);

  protected status = '';
  protected page = 1;
  protected quoteAmount: number | null = null;
  protected quoteNote = '';

  constructor() {
    this.fetch();
  }

  protected badge(r: CakeRequest): string {
    return `adm-badge adm-badge--${CAKE_BADGE[r.status]}`;
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.cakeRequests({ status: this.status || undefined, page: this.page }).subscribe({
      next: (res) => {
        this.requests.set(res.requests);
        this.total.set(res.total);
        this.newCount.set(res.newCount);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openQuote(r: CakeRequest) {
    if (this.openId() === r._id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(r._id);
    this.quoteAmount = r.quote?.amount ?? null;
    this.quoteNote = r.quote?.note ?? '';
  }

  protected saveQuote(r: CakeRequest) {
    if (this.busyId()) return;
    if (!this.quoteAmount) {
      this.toast.error('Enter the quoted price.');
      return;
    }
    this.update(r, { status: 'quoted', quoteAmount: Number(this.quoteAmount), quoteNote: this.quoteNote.trim() });
  }

  protected setStatus(r: CakeRequest, status: CakeRequestStatus) {
    this.update(r, { status });
  }

  private update(r: CakeRequest, data: { status?: CakeRequestStatus; quoteAmount?: number | null; quoteNote?: string }) {
    this.busyId.set(r._id);
    this.admin.updateCakeRequest(r._id, data).subscribe({
      next: () => {
        this.busyId.set(null);
        this.openId.set(null);
        this.fetch();
      },
      error: (err) => {
        this.busyId.set(null);
        this.toast.error(err.error?.message || 'Could not update the request.');
      },
    });
  }
}
