import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { ContactMessage, ContactMessageStatus } from '../../../core/models/admin.model';

/** Enquiry statuses → existing badge tones. */
const MESSAGE_BADGE: Record<ContactMessageStatus, string> = {
  new: 'pending',
  read: 'confirmed',
  closed: 'mock',
};

@Component({
  selector: 'app-admin-enquiries',
  imports: [FormsModule, DatePipe],
  templateUrl: './admin-enquiries.html',
})
export class AdminEnquiries {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly messages = signal<ContactMessage[]>([]);
  protected readonly total = signal(0);
  protected readonly newCount = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);

  protected status = '';
  protected page = 1;

  constructor() {
    this.fetch();
  }

  protected badge(m: ContactMessage): string {
    return `adm-badge adm-badge--${MESSAGE_BADGE[m.status]}`;
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.messages({ status: this.status || undefined, page: this.page }).subscribe({
      next: (res) => {
        this.messages.set(res.messages);
        this.total.set(res.total);
        this.newCount.set(res.newCount);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected setStatus(m: ContactMessage, status: ContactMessageStatus) {
    if (this.busyId()) return;
    this.busyId.set(m._id);
    this.admin.updateMessageStatus(m._id, status).subscribe({
      next: () => {
        this.busyId.set(null);
        this.fetch();
      },
      error: (err) => {
        this.busyId.set(null);
        this.toast.error(err.error?.message || 'Could not update the enquiry.');
      },
    });
  }
}
