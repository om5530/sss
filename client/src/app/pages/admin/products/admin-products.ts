import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';
import { ConfirmModal } from '../shared/confirm-modal';

@Component({
  selector: 'app-admin-products',
  imports: [RouterLink, FormsModule, DecimalPipe, ConfirmModal],
  templateUrl: './admin-products.html',
  styles: `
    .bulk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-bottom: 1rem; }
    .selection-cell { width: 42px; text-align: center; }
    .selection-cell input { width: 16px; height: 16px; accent-color: var(--cocoa); cursor: pointer; }
    .selected-row { background: rgba(230, 178, 96, .12); }
  `,
})
export class AdminProducts {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly products = signal<Product[]>([]);
  protected readonly loading = signal(true);
  protected readonly archiveTarget = signal<Product | null>(null);
  protected readonly busy = signal(false);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly bulkArchiveOpen = signal(false);
  protected readonly selectableProducts = computed(() => this.products().filter((p) => !p.archived));
  protected readonly allSelected = computed(() =>
    this.selectableProducts().length > 0 && this.selectableProducts().every((p) => this.selectedIds().has(p._id)),
  );

  protected selectProduct(product: Product, selected: boolean) {
    if (this.busy() || product.archived) return;
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      if (selected) next.add(product._id);
      else next.delete(product._id);
      return next;
    });
  }

  protected selectAll(selected: boolean) {
    this.selectedIds.set(new Set(selected ? this.selectableProducts().map((p) => p._id) : []));
  }

  protected confirmBulkArchive() {
    const ids = [...this.selectedIds()];
    if (!ids.length || this.busy()) return;
    this.busy.set(true);
    from(ids).pipe(
      concatMap((id) => this.admin.archiveProduct(id, true).pipe(
        map(() => ({ id, success: true })),
        catchError(() => of({ id, success: false })),
      )),
      toArray(),
    ).subscribe((results) => {
      const failed = results.filter((result) => !result.success);
      const archived = results.length - failed.length;
      this.busy.set(false);
      this.bulkArchiveOpen.set(false);
      this.selectedIds.set(new Set(failed.map((result) => result.id)));
      if (archived) this.toast.success(`${archived} product${archived === 1 ? '' : 's'} archived.`);
      if (failed.length) this.toast.error(`${failed.length} product${failed.length === 1 ? '' : 's'} could not be archived. They remain selected so you can retry.`);
      this.fetch(true);
    });
  }

  protected q = '';
  protected group = '';
  protected category = '';
  protected allArchives = false;
  protected availability = '';
  protected showArchived = false;

  protected readonly categories = computed(() =>
    [...new Set(this.products().map((p) => p.category))].sort(),
  );

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(ActivatedRoute).queryParamMap.subscribe((params) => {
      this.category = params.get('category') || '';
      this.group = params.get('group') || '';
      this.allArchives = params.get('archived') === 'all';
      this.fetch();
    });
  }

  protected onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.fetch(), 350);
  }

  protected fetch(preserveSelection = false) {
    if (!preserveSelection) this.selectedIds.set(new Set());
    this.loading.set(true);
    this.admin
      .products({
        q: this.q || undefined,
        group: this.group || undefined,
        category: this.category || undefined,
        available: this.availability || undefined,
        archived: this.allArchives ? 'all' : this.showArchived ? 'true' : undefined,
      })
      .subscribe({
        next: (products) => {
          this.products.set(products);
          this.selectedIds.update((ids) => new Set(products.filter((p) => !p.archived && ids.has(p._id)).map((p) => p._id)));
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
