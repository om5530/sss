import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
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
  private http = inject(HttpClient);
  previewResult = signal<any>(null);
  previewError = signal('');
  revisions = signal<any[]>([]);
  historyRecipe = signal<BakeryRecipe | null>(null);
  private previewRequest?: Subscription;
  private previewTimer?: ReturnType<typeof setTimeout>;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.previewRequest?.unsubscribe();
      clearTimeout(this.previewTimer);
    });
  }
  preview() {
    clearTimeout(this.previewTimer);
    this.previewRequest?.unsubscribe();
    this.previewResult.set(null);
    this.previewError.set('');
    this.previewTimer = setTimeout(() => {
      this.previewRequest = this.http
        .post<any>('/api/admin/bakery/simulate/draft', this.editingRecipe())
        .subscribe({
          next: (r) => this.previewResult.set(r.result),
          error: (e) =>
            this.previewError.set(e.error?.message || 'Complete the recipe to calculate'),
        });
    }, 300);
  }
  addOption() {
    const r = this.editingRecipe();
    if (r) {
      r.options = [...(r.options || []), { name: 'New option', components: [] }];
      this.editingRecipe.set({ ...r });
    }
  }
  addOptionComponent(o: any) {
    const m = this.materials()[0];
    o.components.push({
      componentType: 'material',
      materialId: m?._id,
      name: m?.name,
      quantity: 1,
      uom: m?.baseUom || 'g',
      scalingMethod: 'linear',
    });
    this.preview();
  }
  history(r: BakeryRecipe) {
    this.historyRecipe.set(r);
    this.revisions.set([]);
    this.http
      .get<any>('/api/admin/bakery/recipes/' + r._id + '/versions')
      .subscribe({
        next: (v) => this.revisions.set(v.revisions),
        error: () => {
          this.historyRecipe.set(null);
          this.toast.error('Cannot load recipe history');
        },
      });
  }

  closeHistory() {
    this.revisions.set([]);
    this.historyRecipe.set(null);
  }
  private toast = inject(ToastService);
  private router = inject(Router);

  recipes = signal<BakeryRecipe[]>([]);
  materials = signal<BakeryMaterial[]>([]);
  loading = signal<boolean>(false);
  editingRecipe = signal<Partial<BakeryRecipe> | null>(null);

  selectedCategory = signal<string>('All');
  recipeView = signal<'main' | 'sub'>('main');
  categories = signal<string[]>(['All', 'Cakes', 'Brownies', 'Cookies', 'Pastries', 'Frostings']);
  addingCategory = signal(false);
  newCategoryName = '';
  editingComponentType = signal<number | null>(null);

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
        this.mergeRecipeCategories(res.recipes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  filteredRecipes(): BakeryRecipe[] {
    const cat = this.selectedCategory();
    const isSubRecipe = this.recipeView() === 'sub';
    return this.recipes().filter(
      (r) => Boolean(r.isSubRecipe) === isSubRecipe && (cat === 'All' || r.category === cat),
    );
  }

  subRecipes(excludeId?: string): BakeryRecipe[] {
    return this.recipes().filter((recipe) => recipe.isSubRecipe && recipe._id !== excludeId);
  }

  openCalculator(recipe: BakeryRecipe) {
    this.router.navigate(['/admin/bakery/calculator'], { queryParams: { recipeId: recipe._id } });
  }

  startNewRecipe() {
    this.resetCategoryEditor();
    this.editingRecipe.set({
      name: '',
      code: 'RCP-' + Date.now().toString().slice(-4),
      category: 'Cakes',
      isSubRecipe: false,
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
    this.resetCategoryEditor();
    this.editingRecipe.set(JSON.parse(JSON.stringify(recipe)));
    this.preview();
  }

  cancelEdit() {
    this.resetCategoryEditor();
    this.editingRecipe.set(null);
    this.previewResult.set(null);
  }

  onCategorySelection(recipe: Partial<BakeryRecipe>, value: string) {
    if (value === '__add_new__') {
      this.addingCategory.set(true);
      this.newCategoryName = '';
      return;
    }

    recipe.category = value;
    this.addingCategory.set(false);
  }

  addCategory(recipe: Partial<BakeryRecipe>) {
    const name = this.newCategoryName.trim();
    if (!name) {
      this.toast.error('Category name is required');
      return;
    }

    const existing = this.categories().find(
      (category) => category.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    const category = existing || name;

    if (!existing) {
      this.categories.update((categories) => [...categories, category]);
    }

    recipe.category = category;
    this.resetCategoryEditor();
    this.preview();
  }

  cancelAddCategory() {
    this.resetCategoryEditor();
  }

  private mergeRecipeCategories(recipes: BakeryRecipe[]) {
    const categories = [...this.categories()];
    const known = new Set(categories.map((category) => category.toLocaleLowerCase()));

    for (const recipe of recipes) {
      const category = recipe.category?.trim();
      if (category && !known.has(category.toLocaleLowerCase())) {
        categories.push(category);
        known.add(category.toLocaleLowerCase());
      }
    }

    this.categories.set(categories);
  }

  private resetCategoryEditor() {
    this.addingCategory.set(false);
    this.newCategoryName = '';
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
    this.editingComponentType.set(null);
    this.editingRecipe.set({ ...current });
  }

  componentTypeLabel(type: RecipeComponent['componentType']) {
    if (type === 'sub_recipe') return 'Sub-recipe';
    if (type === 'other') return 'Direct cost';
    return 'Material';
  }

  toggleComponentTypeEditor(index: number) {
    this.editingComponentType.update((current) => (current === index ? null : index));
  }

  setComponentType(
    comp: RecipeComponent,
    type: RecipeComponent['componentType'],
  ) {
    comp.componentType = type;
    comp.materialId = undefined;
    comp.subRecipeId = undefined;
    comp.unitCost = undefined;

    if (type === 'material') {
      const material = this.materials()[0];
      if (material) this.onComponentMaterialChange(comp, material._id);
    } else if (type === 'sub_recipe') {
      const recipe = this.subRecipes(this.editingRecipe()?._id)[0];
      comp.subRecipeId = recipe?._id;
      comp.name = recipe?.name || '';
      comp.itemType = 'sub_recipe';
      comp.uom = recipe?.yieldUom || 'piece';
      comp.scalingMethod = 'linear';
    } else {
      comp.name = '';
      comp.itemType = 'other';
      comp.quantity = comp.quantity || 1;
      comp.uom = 'piece';
      comp.unitCost = 0;
      comp.scalingMethod = 'fixed';
    }

    this.editingComponentType.set(null);
    this.preview();
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
