import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, catchError, from, map, mergeMap, of, toArray } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';
import { ConfirmModal } from '../shared/confirm-modal';
import { AdminProductListState } from '../shared/admin-product-list-state';

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
  private productList = inject(AdminProductListState);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly filtersKey = 'admin-products-filters-v1';

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
    this.listRequest?.unsubscribe();
    this.busy.set(true);
    from(ids).pipe(
      mergeMap((id) => this.admin.archiveProduct(id, true).pipe(
        map((product) => ({ id, product })),
        catchError(() => of({ id, product: null })),
      ), 4),
      toArray(),
    ).subscribe((results) => {
      const failed = results.filter((result) => !result.product);
      const saved = results.flatMap((result) => result.product ? [result.product] : []);
      const archived = saved.length;
      this.busy.set(false);
      this.bulkArchiveOpen.set(false);
      this.selectedIds.set(new Set(failed.map((result) => result.id)));
      for (const product of saved) this.applyArchivedProduct(product);
      if (archived) this.toast.success(`${archived} product${archived === 1 ? '' : 's'} archived.`);
      if (failed.length) this.toast.error(`${failed.length} product${failed.length === 1 ? '' : 's'} could not be archived. They remain selected so you can retry.`);
    });
  }

  private applyArchivedProduct(saved: Product) {
    const visible = (this.allArchives || (this.showArchived ? saved.archived : !saved.archived))
      && (!this.availability || String(saved.available) === this.availability);
    this.products.update((list) => visible
      ? list.map((item) => item._id === saved._id ? { ...item, ...saved } : item)
      : list.filter((item) => item._id !== saved._id));
    this.productList.set(this.filterKey(), this.products());
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
  private listRequest?: Subscription;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.filtersKey) || '{}');
      this.q = typeof saved.q === 'string' ? saved.q : '';
      this.group = ['bakery', 'savoury'].includes(saved.group) ? saved.group : '';
      this.category = typeof saved.category === 'string' ? saved.category : '';
      this.availability = ['true', 'false'].includes(saved.availability) ? saved.availability : '';
      this.showArchived = saved.showArchived === true;
      this.allArchives = saved.allArchives === true;
    } catch { /* Invalid saved filters fall back to defaults. */ }
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.searchTimer);
      this.listRequest?.unsubscribe();
    });
    this.route.queryParamMap.subscribe((params) => {
      if (['category', 'group', 'archived'].some((name) => params.has(name))) {
        this.category = params.get('category') || '';
        this.group = params.get('group') || '';
        this.allArchives = params.get('archived') === 'all';
      }
      this.fetch();
    });
  }

  protected onSearch() {
    clearTimeout(this.searchTimer);
    this.saveFilters();
    this.searchTimer = setTimeout(() => this.fetch(), 350);
  }

  protected hasFilters() {
    return !!(this.q || this.group || this.category || this.availability || this.showArchived || this.allArchives);
  }

  protected clearFilters() {
    clearTimeout(this.searchTimer);
    this.q = '';
    this.group = '';
    this.category = '';
    this.availability = '';
    this.showArchived = false;
    this.allArchives = false;
    localStorage.removeItem(this.filtersKey);
    if (this.route.snapshot.queryParamMap.keys.length) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    } else this.fetch();
  }

  private saveFilters() {
    localStorage.setItem(this.filtersKey, JSON.stringify({
      q: this.q, group: this.group, category: this.category,
      availability: this.availability, showArchived: this.showArchived, allArchives: this.allArchives,
    }));
  }

  private filterKey() {
    return !this.q && !this.group && !this.category && !this.availability && !this.allArchives && !this.showArchived
      ? 'default'
      : JSON.stringify([this.q, this.group, this.category, this.availability, this.allArchives, this.showArchived]);
  }

  protected fetch(preserveSelection = false) {
    this.listRequest?.unsubscribe();
    this.saveFilters();
    if (!preserveSelection) this.selectedIds.set(new Set());
    const key = this.filterKey();
    const cached = this.productList.get(key);
    if (cached) this.products.set(cached);
    this.loading.set(!cached);
    this.listRequest = this.admin
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
          this.productList.set(key, products);
          this.selectedIds.update((ids) => new Set(products.filter((p) => !p.archived && ids.has(p._id)).map((p) => p._id)));
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  /** Inline switches (AS-4.4): optimistic, reverted if the server disagrees. */
  toggle(product: Product, field: 'available' | 'featured') {
    this.listRequest?.unsubscribe();
    const next = !product[field];
    this.products.update((list) => list.map((p) => (p._id === product._id ? { ...p, [field]: next } : p)));
    this.admin.updateProduct(product._id, { [field]: next }).subscribe({
      next: (saved) => this.applyArchivedProduct(saved),
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
    this.listRequest?.unsubscribe();
    this.busy.set(true);
    this.admin.archiveProduct(product._id, archiving).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.archiveTarget.set(null);
        this.toast.success(`"${product.name}" ${archiving ? 'archived' : 'restored'}.`);
        this.applyArchivedProduct(saved);
        this.selectedIds.update((ids) => {
          const next = new Set(ids);
          next.delete(saved._id);
          return next;
        });
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(err.error?.message || 'Could not update the product.');
      },
    });
  }
}
