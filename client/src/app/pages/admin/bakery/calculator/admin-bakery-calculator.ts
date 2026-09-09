import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BakeryService } from '../../../../core/services/bakery.service';
import {
  BakeryRecipe,
  ScaledRecipeResult,
  MultiProductResult,
} from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-bakery-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './admin-bakery-calculator.html',
  styleUrl: './admin-bakery-calculator.scss',
})
export class AdminBakeryCalculator implements OnInit {
  private bakery = inject(BakeryService);
  private toast = inject(ToastService);

  mode = signal<'single' | 'multi'>('single');
  recipes = signal<BakeryRecipe[]>([]);
  loading = signal<boolean>(false);

  // Single Recipe Mode State
  selectedRecipeId = signal<string>('');
  quantity = signal<number>(1);
  markupPercent = signal<number>(50);
  singleResult = signal<ScaledRecipeResult | null>(null);

  // Multi-Product Plan State
  multiItems = signal<{ recipeId: string; quantity: number }[]>([
    { recipeId: '', quantity: 1 },
  ]);
  multiResult = signal<MultiProductResult | null>(null);
  referenceName = signal<string>('');
  customerName = signal<string>('');

  ngOnInit() {
    this.fetchRecipes();
  }

  fetchRecipes() {
    this.loading.set(true);
    this.bakery.getRecipes().subscribe({
      next: (res) => {
        this.recipes.set(res.recipes);
        if (res.recipes.length > 0 && !this.selectedRecipeId()) {
          this.selectedRecipeId.set(res.recipes[0]._id);
          this.markupPercent.set(res.recipes[0].targetMarkupPercent || 50);
          this.calculateSingle();
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setMode(m: 'single' | 'multi') {
    this.mode.set(m);
    if (m === 'multi' && this.multiItems().length === 1 && !this.multiItems()[0].recipeId) {
      if (this.recipes().length > 0) {
        this.multiItems.set([{ recipeId: this.recipes()[0]._id, quantity: 2 }]);
        this.calculateMulti();
      }
    }
  }

  calculateSingle() {
    const id = this.selectedRecipeId();
    const qty = this.quantity();
    if (!id || qty <= 0) return;

    this.bakery.simulateRecipe(id, qty, this.markupPercent()).subscribe({
      next: (res) => this.singleResult.set(res.scaled),
      error: (err) => this.toast.error(err.error?.message || 'Calculation error'),
    });
  }

  onRecipeChange() {
    const rec = this.recipes().find((r) => r._id === this.selectedRecipeId());
    if (rec) {
      this.markupPercent.set(rec.targetMarkupPercent || 50);
    }
    this.calculateSingle();
  }

  // Multi item management
  addMultiItem() {
    const firstId = this.recipes().length > 0 ? this.recipes()[0]._id : '';
    this.multiItems.update((items) => [...items, { recipeId: firstId, quantity: 1 }]);
    this.calculateMulti();
  }

  removeMultiItem(index: number) {
    this.multiItems.update((items) => items.filter((_, i) => i !== index));
    this.calculateMulti();
  }

  updateMultiQuantity(index: number, newQty: number) {
    this.multiItems.update((items) => {
      const copy = [...items];
      copy[index] = { ...copy[index], quantity: Math.max(1, newQty) };
      return copy;
    });
    this.calculateMulti();
  }

  updateMultiRecipe(index: number, newId: string) {
    this.multiItems.update((items) => {
      const copy = [...items];
      copy[index] = { ...copy[index], recipeId: newId };
      return copy;
    });
    this.calculateMulti();
  }

  calculateMulti() {
    const validItems = this.multiItems().filter((item) => item.recipeId && item.quantity > 0);
    if (validItems.length === 0) {
      this.multiResult.set(null);
      return;
    }

    this.bakery.simulateMulti(validItems, this.markupPercent()).subscribe({
      next: (res) => this.multiResult.set(res.aggregated),
      error: (err) => this.toast.error(err.error?.message || 'Multi-calculation error'),
    });
  }

  savePlan(type: 'production_plan' | 'costing_sheet') {
    const res = this.multiResult();
    if (!res) return;

    const payload = {
      type,
      referenceName: this.referenceName().trim() || `Plan ${new Date().toLocaleDateString()}`,
      customerName: this.customerName().trim() || undefined,
      items: this.multiItems().map((it) => {
        const rec = this.recipes().find((r) => r._id === it.recipeId);
        return {
          recipeId: it.recipeId,
          recipeName: rec ? rec.name : '',
          quantity: it.quantity,
          yieldUom: rec?.yieldUom || 'unit',
          totalCost: (rec?.costPerUnit || 0) * it.quantity,
        };
      }),
      ingredientCost: res.ingredientCost,
      packagingCost: res.packagingCost,
      labourCost: res.labourCost,
      resourceCost: res.resourceCost,
      totalCost: res.totalCost,
      markupPercent: res.markupPercent,
      marginPercent: res.marginPercent,
      suggestedSellingPrice: res.suggestedSellingPrice,
      status: 'scheduled',
    };

    this.bakery.saveCostingSheet(payload).subscribe({
      next: () => {
        this.toast.success(type === 'production_plan' ? 'Production plan saved!' : 'Costing sheet saved!');
      },
      error: () => this.toast.error('Failed to save plan'),
    });
  }

  printPrep() {
    window.print();
  }
}
