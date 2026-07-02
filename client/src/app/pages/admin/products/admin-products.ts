import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';
import { ConfirmModal } from '../shared/confirm-modal';

@Component({
  selector: 'app-admin-products',
  imports: [RouterLink, FormsModule, DecimalPipe, ConfirmModal],
  templateUrl: './admin-products.html',
})
export class AdminProducts {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly products = signal<Product[]>([]);
  protected readonly loading = signal(true);
  protected readonly archiveTarget = signal<Product | null>(null);
  protected readonly busy = signal(false);

  protected q = '';
  protected group = '';
  protected availability = '';
  protected showArchived = false;

  protected readonly categories = computed(() =>
    [...new Set(this.products().map((p) => p.category))].sort(),
  );

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.fetch();
  }

  protected onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.fetch(), 350);
  }

  protected fetch() {
    this.loading.set(true);
    this.admin
      .products({
        q: this.q || undefined,
        group: this.group || undefined,
        available: this.availability || undefined,
        archived: this.showArchived ? 'true' : undefined,
      })
      .subscribe({
        next: (products) => {
          this.products.set(products);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  /** Inline switches (AS-4.4): optimistic, reverted if the server disagrees. */
  toggle(product: Product, field: 'available' | 'featured') {
    const next = !product[field];
    this.products.update((list) => list.map((p) => (p._id === product._id ? { ...p, [field]: next } : p)));
    this.admin.updateProduct(product._id, { [field]: next }).subscribe({
      error: (err) => {
        this.products.update((list) => list.map((p) => (p._id === product._id ? { ...p, [field]: !next } : p)));
        this.toast.error(err.error?.message || 'Could not save the change.');
      },
    });
  }

  confirmArchive() {
    const product = this.archiveTarget();
    if (!product) return;
    const archiving = !product.archived;
    this.busy.set(true);
    this.admin.archiveProduct(product._id, archiving).subscribe({
      next: () => {
        this.busy.set(false);
        this.archiveTarget.set(null);
        this.toast.success(`"${product.name}" ${archiving ? 'archived' : 'restored'}.`);
        this.fetch();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(err.error?.message || 'Could not update the product.');
      },
    });
  }
}
