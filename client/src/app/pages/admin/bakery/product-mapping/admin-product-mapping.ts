import { BusyButton } from '../../shared/busy-button';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BakeryService } from '../../../../core/services/bakery.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ProductRecipeMapping } from '../../../../core/models/bakery.model';
import { AdminProductListState } from '../../shared/admin-product-list-state';

type MappingProduct = ProductRecipeMapping['products'][number];
@Component({
  selector: 'app-admin-product-mapping',
  imports: [BusyButton, RouterLink, FormsModule, DecimalPipe],
  templateUrl: './admin-product-mapping.html',
  styles: `
    .mapping-select { min-width: 240px; max-width: 350px; }
    .mapping-hint { display: block; margin-top: .3rem; font-size: .78rem; }
    .mapping-search { flex: 1; min-width: 220px; max-width: 420px; }
    .mapping-note { margin: .8rem 0; }
    .mapping-status { margin-bottom: .7rem; }
  `,
})
export class AdminProductMapping {
  private api = inject(BakeryService);
  private toast = inject(ToastService);
  private destroy = inject(DestroyRef);
  private productList = inject(AdminProductListState);
  protected readonly data = signal<ProductRecipeMapping | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly q = signal('');
  protected readonly filter = signal('linked');
  protected readonly choices = signal<Record<string, string>>({});
  protected readonly linkedCount = computed(() => this.data()?.products.filter((p) => p.recipeId).length || 0);
  protected readonly products = computed(() => {
    const q = this.q().trim().toLowerCase();
    return (this.data()?.products || []).filter((p) =>
      (!q || `${p.name} ${p.category} ${p.recipeName} ${this.selectedRecipe(p)?.recipeName || ''} ${this.selectedRecipe(p)?.revisionLabel || ''}`.toLowerCase().includes(q)) &&
      (this.filter() === 'all' || (this.filter() === 'linked' ? !!p.recipeId : !p.recipeId)));
  });
  constructor() { this.load(); }
  protected load() {
    this.loading.set(true); this.failed.set(false);
    this.api.getProductMappings().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (data) => { this.data.set(data); this.loading.set(false); },
      error: () => { this.failed.set(true); this.loading.set(false); },
    });
  }
  protected selectedId(p: MappingProduct) { return this.choices()[p._id] ?? p.recipeId ?? ''; }
  protected selectedRecipe(p: MappingProduct) { return this.data()?.recipes.find((r) => r.recipeId === this.selectedId(p)); }
  protected choose(p: MappingProduct, recipeId: string) { this.choices.update((c) => ({ ...c, [p._id]: recipeId })); }
  protected changed(p: MappingProduct) { return this.selectedId(p) !== (p.recipeId || ''); }
  protected save(p: MappingProduct) {
    if (this.busyId() || !this.changed(p)) return;
    const recipe = this.selectedRecipe(p);
    if (recipe?.error) return;
    this.busyId.set(p._id);
    this.api.saveProductMapping(p._id, { recipeId: this.selectedId(p) || null, expectedRecipeId: p.recipeId,
      expectedVersion: recipe?.version, expectedUpdatedAt: p.updatedAt }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.busyId.set(null);
        this.choices.update((c) => { const next = { ...c }; delete next[p._id]; return next; });
        this.productList.clear();
        this.toast.success(recipe ? `${p.name} linked. Selling price is ₹${recipe.sellingPrice?.toFixed(2)}.` : `${p.name} unlinked. Its last selling price is kept.`);
        this.load();
      },
      error: (err) => { this.busyId.set(null); this.toast.error(err.error?.message || 'Could not save the mapping. Please retry.'); },
    });
  }
}
