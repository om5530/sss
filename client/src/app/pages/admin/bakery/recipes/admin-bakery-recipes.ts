import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BakeryService } from '../../../../core/services/bakery.service';
import {
  BakeryRecipe,
  BakeryMaterial,
  RecipeComponent,
} from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-bakery-recipes',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './admin-bakery-recipes.html',
  styleUrl: './admin-bakery-recipes.scss',
})
export class AdminBakeryRecipes implements OnInit {
  private bakery = inject(BakeryService);
  private toast = inject(ToastService);
  private router = inject(Router);

  recipes = signal<BakeryRecipe[]>([]);
  materials = signal<BakeryMaterial[]>([]);
  loading = signal<boolean>(false);
  editingRecipe = signal<Partial<BakeryRecipe> | null>(null);

  selectedCategory = signal<string>('All');
  categories = signal<string[]>(['All', 'Cakes', 'Brownies', 'Cookies', 'Pastries', 'Frostings']);

  ngOnInit() {
    this.fetchData();
  }

  fetchData() {
    this.loading.set(true);
    this.bakery.getMaterials().subscribe({
      next: (res) => this.materials.set(res.materials),
    });

    this.bakery.getRecipes().subscribe({
      next: (res) => {
        this.recipes.set(res.recipes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  filteredRecipes(): BakeryRecipe[] {
    const cat = this.selectedCategory();
    if (cat === 'All') return this.recipes();
    return this.recipes().filter((r) => r.category === cat);
  }

  openCalculator(recipe: BakeryRecipe) {
    this.router.navigate(['/admin/bakery/calculator']);
  }

  startNewRecipe() {
    this.editingRecipe.set({
      name: '',
      code: 'RCP-' + Date.now().toString().slice(-4),
      category: 'Cakes',
      baseBatchUnits: 1,
      yieldQuantity: 1,
      yieldUom: 'cake',
      finishedWeightGrams: 500,
      targetMarkupPercent: 50,
      instructions: [''],
      components: [
        {
          componentType: 'material',
          name: '',
          itemType: 'ingredient',
          quantity: 100,
          uom: 'g',
          scalingMethod: 'linear',
        },
      ],
    });
  }

  editRecipe(recipe: BakeryRecipe) {
    this.editingRecipe.set(JSON.parse(JSON.stringify(recipe)));
  }

  cancelEdit() {
    this.editingRecipe.set(null);
  }

  addComponent() {
    const current = this.editingRecipe();
    if (!current) return;
    const comps = current.components || [];
    const firstMat = this.materials().length > 0 ? this.materials()[0] : null;

    comps.push({
      componentType: 'material',
      materialId: firstMat ? firstMat._id : undefined,
      name: firstMat ? firstMat.name : '',
      itemType: firstMat ? firstMat.type : 'ingredient',
      quantity: 50,
      uom: firstMat ? firstMat.baseUom : 'g',
      scalingMethod: 'linear',
    });
    this.editingRecipe.set({ ...current, components: comps });
  }

  removeComponent(index: number) {
    const current = this.editingRecipe();
    if (!current || !current.components) return;
    current.components.splice(index, 1);
    this.editingRecipe.set({ ...current });
  }

  onComponentMaterialChange(comp: RecipeComponent, matId: string) {
    const mat = this.materials().find((m) => m._id === matId);
    if (mat) {
      comp.materialId = mat._id;
      comp.name = mat.name;
      comp.itemType = mat.type;
      comp.uom = mat.baseUom;
      if (mat.type === 'resource') {
        comp.scalingMethod = 'stepped';
        comp.capacityPerCycle = 4;
        comp.cycleMinutes = 60;
      }
    }
  }

  saveRecipe() {
    const recipe = this.editingRecipe();
    if (!recipe || !recipe.name?.trim()) {
      this.toast.error('Recipe name is required');
      return;
    }

    if (recipe._id) {
      this.bakery.updateRecipe(recipe._id, recipe).subscribe({
        next: () => {
          this.toast.success('Recipe updated');
          this.editingRecipe.set(null);
          this.fetchData();
        },
        error: () => this.toast.error('Failed to update recipe'),
      });
    } else {
      this.bakery.createRecipe(recipe).subscribe({
        next: () => {
          this.toast.success('Recipe created');
          this.editingRecipe.set(null);
          this.fetchData();
        },
        error: () => this.toast.error('Failed to create recipe'),
      });
    }
  }

  deleteRecipe(id: string) {
    if (!confirm('Are you sure you want to archive this recipe?')) return;
    this.bakery.deleteRecipe(id).subscribe({
      next: () => {
        this.toast.success('Recipe archived');
        this.fetchData();
      },
      error: () => this.toast.error('Failed to delete recipe'),
    });
  }
}
