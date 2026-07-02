import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { AuditEntry } from '../../../core/models/admin.model';

@Component({
  selector: 'app-admin-activity',
  imports: [FormsModule, DatePipe],
  templateUrl: './admin-activity.html',
})
export class AdminActivity {
  private admin = inject(AdminService);

  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);

  protected entity = '';
  protected page = 1;

  constructor() {
    this.fetch();
  }

  protected goToPage(page: number) {
    this.page = Math.min(Math.max(1, page), this.pages());
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.audit({ entity: this.entity || undefined, page: this.page }).subscribe({
      next: (res) => {
        this.entries.set(res.entries);
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
