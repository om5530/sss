import { groupRecipeRevisions, searchRecipeGroups, selectRecipeRevision, type RecipeRevisionGroup } from './recipe-revision-groups';
import { setRecipeComponentQuantity } from './recipe-component-usage';
import { ConfirmModal } from '../../shared/confirm-modal';
import { BusyButton } from '../../shared/busy-button';
import { Component, computed, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BakeryService } from '../../../../core/services/bakery.service';
import {
  BakeryRecipe,
  BakeryMaterial,
  RecipeComponent,
} from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminProductListState } from '../../shared/admin-product-list-state';

@Component({
  selector: 'app-admin-bakery-recipes',
  standalone: true,
  imports: [ConfirmModal, BusyButton, CommonModule, FormsModule, CurrencyPipe, RouterLink],
  templateUrl: './admin-bakery-recipes.html',
  styleUrl: './admin-bakery-recipes.scss',
})
export class AdminBakeryRecipes implements OnInit {
  private bakery = inject(BakeryService);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private requestedRecipeOpened = false;
  private productList = inject(AdminProductListState);
  priceDrafts = signal<Record<string, number | null>>({});
  savingPriceId = signal<string | null>(null);
  protected readonly suggestionTarget = signal<BakeryRecipe | null>(null);
  private priceRequest?: Subscription;
  previewResult = signal<any>(null);
  previewError = signal('');
  revisions = signal<any[]>([]);
  historyRecipe = signal<BakeryRecipe | null>(null);
  private previewRequest?: Subscription;
  private recipesRequest?: Subscription;
  private previewTimer?: ReturnType<typeof setTimeout>;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.previewRequest?.unsubscribe();
      this.recipesRequest?.unsubscribe();
      this.priceRequest?.unsubscribe();
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

  recipes = signal<BakeryRecipe[]>([]);
  materials = signal<BakeryMaterial[]>([]);

  materialBackground(name: string): string {
    const firstLetter = name.trim().charAt(0).toUpperCase();
    if (!/^[A-Z]$/.test(firstLetter)) return '#f0ece5';
    const hue = Math.round(((firstLetter.charCodeAt(0) - 65) * 137.508) % 360);
    return `hsl(${hue}, 65%, 90%)`;
  }

  loading = signal<boolean>(false);
  saving = signal(false);
  saveError = signal('');
  editingRecipe = signal<Partial<BakeryRecipe> | null>(null);
  revisionSource = signal<BakeryRecipe | null>(null);
  revisionSelections = signal<Record<string, string>>({});
  protected readonly recipeSearch = signal('');
  recipeGroups = computed(() => searchRecipeGroups(groupRecipeRevisions(this.filteredRecipes()), this.recipeSearch()));

  selectedRevision(group: RecipeRevisionGroup): BakeryRecipe {
    return selectRecipeRevision(group, this.revisionSelections()[group.id]);
  }

  selectRevision(group: RecipeRevisionGroup, id: string) {
    this.revisionSelections.update(selected => ({ ...selected, [group.id]: id }));
  }

  selectedCategory = signal<string>('All');
  recipeView = signal<'main' | 'sub'>('main');
  categories = signal<string[]>(['All', 'Cakes', 'Brownies', 'Cookies', 'Filling']);
  filterCategories = computed(() => this.categories().filter((category) =>
    !['pastries', 'frostings', 'dessert', 'biscuits'].includes(category.toLocaleLowerCase()),
  ));
  addingCategory = signal(false);
  newCategoryName = '';
  editingComponentType = signal<number | null>(null);

  ngOnInit() {
    this.fetchData();
  }

  fetchData() {
    this.loading.set(true);
    this.bakery.getMaterials().subscribe({
      next: (res) => this.materials.set([...res.materials].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      )),
    });
    this.fetchRecipes();
  }

  private fetchRecipes() {
    this.recipesRequest?.unsubscribe();
    this.recipesRequest = this.bakery.getRecipes().subscribe({
      next: (res) => {
        this.recipes.set(res.recipes);
        this.mergeRecipeCategories(res.recipes);
        this.loading.set(false);
        const requested = this.route.snapshot.queryParamMap.get('recipeId');
        if (requested && !this.requestedRecipeOpened) {
          const recipe = res.recipes.find((r) => r._id === requested);
          if (recipe) { this.requestedRecipeOpened = true; this.editRecipe(recipe); }
        }
      },
      error: () => this.loading.set(false),
    });
  }

  filteredRecipes(): BakeryRecipe[] {
    const cat = this.selectedCategory();
    const isSubRecipe = this.recipeView() === 'sub';
    return this.recipes().filter(
      (r) => Boolean(r.isSubRecipe) === isSubRecipe && (cat === 'All' || this.displayCategory(r) === cat),
    ).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (a.revisionNumber || 1) - (b.revisionNumber || 1));
  }

  displayCategory(recipe: BakeryRecipe): string {
    if (recipe.isSubRecipe && /\bfilling\b/i.test(recipe.name)
      && ['dessert', 'frostings'].includes(recipe.category.trim().toLocaleLowerCase())) {
      return 'Filling';
    }
    return recipe.category;
  }

  subRecipes(excludeId?: string): BakeryRecipe[] {
    return this.recipes().filter((recipe) => recipe.isSubRecipe && recipe._id !== excludeId);
  }

  startNewRecipe() {
    this.revisionSource.set(null);
    this.resetCategoryEditor();
    this.editingRecipe.set({
      name: '',
      code: 'RCP-' + Date.now().toString().slice(-4),
      category: 'Cakes',
      isSubRecipe: false,
      baseBatchUnits: 1,
      yieldQuantity: 1,
      yieldUom: 'cake',
      piecesPerBatch: 1,
      finishedWeightGrams: 500,
      targetMarkupPercent: 50,
      manualSellingPricePerPiece: null,
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
    this.revisionSource.set(null);
    this.resetCategoryEditor();
    this.editingRecipe.set({
      ...JSON.parse(JSON.stringify(recipe)), category: this.displayCategory(recipe),
      manualSellingPricePerPiece: this.hasAdminPrice(recipe) ? this.savedPiecePrice(recipe) : null,
    });
    this.preview();
  }

  cancelEdit() {
    this.revisionSource.set(null);
    this.resetCategoryEditor();
    this.editingRecipe.set(null);
    this.previewResult.set(null);
  }

  duplicateRecipe(recipe: BakeryRecipe) {
    this.revisionSource.set(null);
    this.resetCategoryEditor();
    this.editingComponentType.set(null);
    const copy = JSON.parse(JSON.stringify(recipe)) as BakeryRecipe;
    const baseName = `${recipe.name} (Copy)`;
    let name = baseName;
    let suffix = 2;
    const names = new Set(this.recipes().map((item) => item.name.toLocaleLowerCase()));
    while (names.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`;

    this.editingRecipe.set({
      name,
      code: 'RCP-' + crypto.randomUUID(),
      category: this.displayCategory(recipe),
      isSubRecipe: copy.isSubRecipe,
      baseBatchUnits: copy.baseBatchUnits,
      yieldQuantity: copy.yieldQuantity,
      yieldUom: copy.yieldUom,
      piecesPerBatch: copy.piecesPerBatch,
      finishedWeightGrams: copy.finishedWeightGrams,
      targetMarkupPercent: copy.targetMarkupPercent,
      manualSellingPricePerPiece: this.hasAdminPrice(recipe) ? this.savedPiecePrice(recipe) : null,
      overheadPerBatch: copy.overheadPerBatch,
      expectedLossPercent: copy.expectedLossPercent,
      instructions: copy.instructions,
      notes: copy.notes,
      components: copy.components.map(({ _id, ...component }) => component),
      options: copy.options?.map((option) => ({
        name: option.name,
        components: option.components.map(({ _id, ...component }) => component),
      })),
    });
    this.preview();
  }

  createRevision(recipe: BakeryRecipe) {
    this.duplicateRecipe(recipe);
    this.revisionSource.set(recipe);
    this.editingRecipe.update((draft) => ({ ...draft, name: recipe.name, revisionLabel: '' }));
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
    this.saveError.set('');
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

  setComponentQuantity(comp: RecipeComponent, quantity: number) {
    setRecipeComponentQuantity(comp, quantity);
    this.preview();
  }

  onComponentMaterialChange(comp: RecipeComponent, matId: string) {
    const mat = this.materials().find((m) => m._id === matId);
    if (mat) {
      comp.materialId = mat._id;
      comp.name = mat.name;
      comp.itemType = mat.type;
      comp.scalingMethod = 'linear';
      comp.uom = mat.baseUom;
      if (mat.type === 'resource') {
        comp.scalingMethod = 'linear';
        comp.capacityPerCycle = 4;
        comp.cycleMinutes = 60;
      }
    }
  }

  saveRecipe() {
    const recipe = this.editingRecipe();
    if (this.saving()) return;
    if (!recipe || !recipe.name?.trim()) {
      this.toast.error('Recipe name is required');
      return;
    }
    if (!Number.isInteger(Number(recipe.piecesPerBatch)) || Number(recipe.piecesPerBatch) < 1) {
      this.toast.error('Enter a whole number of pieces per batch');
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    if (recipe._id) {
      this.bakery.updateRecipe(recipe._id, recipe).subscribe({
        next: (res) => {
          this.saving.set(false);
          this.toast.success(res.message || 'Recipe updated');
          this.productList.clear();
          this.clearPriceDraft(res.recipe._id);
          this.editingRecipe.set(null);
          this.upsertRecipe(res.recipe);
          // Only recipes that use this recipe can have changed costs.
          if (this.recipes().some((parent) => [
            ...parent.components, ...(parent.options || []).flatMap((option) => option.components || []),
          ].some((component) => component.subRecipeId === res.recipe._id))) this.fetchRecipes();
        },
        error: (e) => {
          this.saving.set(false);
          this.saveError.set(e.error?.message || 'Failed to update recipe. Please try again.');
          this.toast.error(this.saveError());
        },
      });
    } else {
      const source = this.revisionSource();
      const request = source
        ? this.http.post<{ recipe: BakeryRecipe }>('/api/admin/bakery/recipes/' + source._id + '/revisions', { ...recipe, version: source.version })
        : this.bakery.createRecipe(recipe);
      request.subscribe({
        next: (res) => {
          this.saving.set(false);
          if (source) this.revisionSelections.update(selected => ({
            ...selected, [res.recipe.revisionFamilyId || res.recipe._id]: res.recipe._id,
          }));
          this.toast.success(source ? 'Revision created. Choose it in Product mapping when ready.' : 'Recipe created');
          this.revisionSource.set(null);
          this.editingRecipe.set(null);
          this.upsertRecipe(res.recipe);
        },
        error: (e) => {
          this.saving.set(false);
          this.saveError.set(e.error?.message || 'Failed to create recipe. Please try again.');
          this.toast.error(this.saveError());
        },
      });
    }
  }

  private savedPiecePrice(recipe: BakeryRecipe): number {
    return Number(Number(recipe.sellingPricePerPiece ?? 0).toFixed(2));
  }

  piecePrice(recipe: BakeryRecipe): number | null {
    const drafts = this.priceDrafts();
    return Object.hasOwn(drafts, recipe._id) ? drafts[recipe._id] : this.savedPiecePrice(recipe);
  }

  setPiecePrice(recipe: BakeryRecipe, value: number | null) {
    this.priceDrafts.update((drafts) => ({ ...drafts, [recipe._id]: value }));
  }

  priceChanged(recipe: BakeryRecipe): boolean {
    return this.piecePrice(recipe) !== this.savedPiecePrice(recipe);
  }

  hasAdminPrice(recipe: BakeryRecipe): boolean {
    return Number(recipe.manualSellingPricePerPiece ?? 0) > 0 || Number(recipe.manualSellingPrice ?? 0) > 0;
  }

  savePiecePrice(recipe: BakeryRecipe, useSuggestion = false) {
    if (this.savingPriceId() || recipe.costingError) return;
    if (useSuggestion) {
      this.suggestionTarget.set(recipe);
      return;
    }
    this.persistPiecePrice(recipe);
  }

  protected suggestionMessage(recipe: BakeryRecipe): string {
    const price = Number(recipe.suggestedSellingPrice) / Number(recipe.piecesPerBatch);
    return `Replace the saved selling price of ₹${this.savedPiecePrice(recipe).toFixed(2)} per piece with the suggested price of ₹${price.toFixed(2)} per piece? This removes your custom price.` +
      (recipe.productId ? ' The linked product price will also be updated.' : '');
  }

  protected confirmSuggestion() {
    const recipe = this.suggestionTarget();
    if (recipe && !this.savingPriceId()) this.persistPiecePrice(recipe, true);
  }

  private persistPiecePrice(recipe: BakeryRecipe, useSuggestion = false) {
    if (this.savingPriceId() || recipe.costingError) return;
    const price = this.piecePrice(recipe);
    if (!useSuggestion && (!Number.isFinite(price) || Number(price) <= 0 ||
      Math.abs(Number(price) * 100 - Math.round(Number(price) * 100)) > 0.000001)) {
      this.toast.error('Enter a selling price above ₹0, with at most two decimal places');
      return;
    }
    this.savingPriceId.set(recipe._id);
    this.priceRequest = this.bakery.updateRecipeSellingPrice(recipe._id, {
      version: Number(recipe.version), pricePerPiece: useSuggestion ? null : price,
    }).subscribe({
      next: (res) => {
        this.recipes.update((recipes) => recipes.map((item) => item._id === res.recipe._id ? res.recipe : item));
        this.clearPriceDraft(recipe._id);
        this.productList.clear();
        this.savingPriceId.set(null);
        if (useSuggestion) this.suggestionTarget.set(null);
        this.toast.success(recipe.productId ? 'Selling price saved and linked product updated' : 'Selling price saved');
      },
      error: (e) => {
        this.savingPriceId.set(null);
        this.toast.error(e.error?.message || 'Could not save selling price');
        if (useSuggestion) this.suggestionTarget.set(null);
        if (e.status === 409) {
          this.clearPriceDraft(recipe._id);
          this.fetchRecipes();
        }
      },
    });
  }

  private clearPriceDraft(id: string) {
    this.priceDrafts.update((drafts) => {
      const remaining = { ...drafts };
      delete remaining[id];
      return remaining;
    });
  }

  private upsertRecipe(recipe: BakeryRecipe) {
    this.recipesRequest?.unsubscribe();
    this.recipes.update((recipes) => [recipe, ...recipes.filter((item) => item._id !== recipe._id)]);
    this.mergeRecipeCategories([recipe]);
  }

  deleteRecipe(id: string) {
    if (!confirm('Are you sure you want to archive this recipe?')) return;
    this.bakery.deleteRecipe(id).subscribe({
      next: () => {
        this.toast.success('Recipe archived');
        this.recipesRequest?.unsubscribe();
        this.recipes.update((recipes) => recipes.filter((recipe) => recipe._id !== id));
      },
      error: () => this.toast.error('Failed to delete recipe'),
    });
  }
}
