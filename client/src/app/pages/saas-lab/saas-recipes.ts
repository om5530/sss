import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SaasService } from '../../core/services/saas.service';
import { SaasMaterial, SaasRecipe, SaasRecipeDetail, SaasRecipeRevision, SaasUom } from '../../core/models/saas-recipe.model';
import { SaasProduct } from '../../core/models/saas-product.model';
import { parseRupeesToPaise } from '../../core/utils/saas-money';

@Component({ selector: 'app-saas-recipes', imports: [FormsModule, CurrencyPipe], templateUrl: './saas-recipes.html', styleUrl: './saas-lab.scss' })
export class SaasRecipes implements OnChanges, OnDestroy {
  @Input({ required: true }) bakeryId!: string;
  private readonly api = inject(SaasService);
  private generation = 0;
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly materials = signal<SaasMaterial[]>([]);
  protected readonly recipes = signal<SaasRecipe[]>([]);
  protected readonly products = signal<SaasProduct[]>([]);
  protected readonly materialCursor = signal<string | null>(null);
  protected readonly recipeCursor = signal<string | null>(null);
  protected readonly productCursor = signal<string | null>(null);
  protected readonly detail = signal<SaasRecipeDetail | null>(null);
  protected readonly selectedRevision = signal<SaasRecipeRevision | null>(null);
  protected readonly editing = signal<'new' | 'revision' | null>(null);
  protected readonly materialTarget = signal<SaasMaterial | null>(null);
  protected readonly units: SaasUom[] = ['mg', 'g', 'kg', 'ml', 'L', 'piece', 'dozen', 'packet', 'box', 'minute', 'hour'];
  protected familyId = '';
  protected mappingProductId = '';
  protected materialForm = { name: '', packQuantity: '', packUom: 'g' as SaasUom, price: '', type: 'ingredient' as SaasMaterial['type'] };
  protected form = { name: '', category: 'Cakes', label: '', yieldPieces: 8, overhead: '0', notes: '', ingredients: [{ materialId: '', quantity: '', uom: 'g' as SaasUom }] };

  ngOnChanges() { void this.refresh(); }
  ngOnDestroy() { this.generation++; }
  protected rupees(paise: string): number { return Number(paise) / 100; }
  private failure(error: unknown) {
    this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
      ? error.error.message : 'Could not complete the request. Refresh this workspace and retry.');
  }
  protected async refresh() {
    const generation = ++this.generation;
    this.materials.set([]); this.recipes.set([]); this.products.set([]); this.detail.set(null); this.selectedRevision.set(null);
    this.materialCursor.set(null); this.recipeCursor.set(null); this.productCursor.set(null);
    this.editing.set(null); this.materialTarget.set(null); this.familyId = ''; this.mappingProductId = '';
    this.materialForm = { name: '', packQuantity: '', packUom: 'g', price: '', type: 'ingredient' };
    this.form = { name: '', category: 'Cakes', label: '', yieldPieces: 8, overhead: '0', notes: '', ingredients: [{ materialId: '', quantity: '', uom: 'g' }] };
    this.notice.set('');
    this.loading.set(true); this.error.set(''); this.busy.set(false);
    try {
      const [materials, recipes, products] = await Promise.all([
        firstValueFrom(this.api.materials(this.bakeryId)), firstValueFrom(this.api.recipes(this.bakeryId)), firstValueFrom(this.api.products(this.bakeryId, { limit: 100 })),
      ]);
      if (generation !== this.generation) return;
      this.materials.set(materials.items); this.materialCursor.set(materials.nextCursor);
      this.recipes.set(recipes.items); this.recipeCursor.set(recipes.nextCursor);
      this.products.set(products.products); this.productCursor.set(products.nextCursor);
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async more(kind: 'materials' | 'recipes' | 'products') {
    if (this.busy() || this.loading()) return;
    const cursor = kind === 'materials' ? this.materialCursor() : kind === 'recipes' ? this.recipeCursor() : this.productCursor();
    if (!cursor) return;
    const generation = this.generation; this.loading.set(true);
    try {
      if (kind === 'materials') {
        const result = await firstValueFrom(this.api.materials(this.bakeryId, cursor)); if (generation !== this.generation) return;
        this.materials.update(rows => [...rows, ...result.items]); this.materialCursor.set(result.nextCursor);
      } else if (kind === 'recipes') {
        const result = await firstValueFrom(this.api.recipes(this.bakeryId, cursor)); if (generation !== this.generation) return;
        this.recipes.update(rows => [...rows, ...result.items]); this.recipeCursor.set(result.nextCursor);
      } else {
        const result = await firstValueFrom(this.api.products(this.bakeryId, { limit: 100, cursor })); if (generation !== this.generation) return;
        this.products.update(rows => [...rows, ...result.products]); this.productCursor.set(result.nextCursor);
      }
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected editMaterial(material: SaasMaterial | null) {
    if (this.busy() || this.loading()) return;
    this.materialTarget.set(material);
    this.materialForm = material ? { name: material.name, packQuantity: material.packQuantity, packUom: material.packUom,
      price: (material.purchasePricePaise / 100).toFixed(2), type: material.type }
      : { name: '', packQuantity: '', packUom: 'g', price: '', type: 'ingredient' };
  }
  protected async saveMaterial() {
    if (this.busy() || this.loading()) return;
    const purchasePricePaise = parseRupeesToPaise(this.materialForm.price);
    if (purchasePricePaise === null) { this.error.set('Enter a pack price with up to two decimal places.'); return; }
    const generation = this.generation, target = this.materialTarget(); this.busy.set(true); this.error.set('');
    const { price, ...fields } = this.materialForm;
    try {
      const material = await firstValueFrom(target ? this.api.updateMaterial(this.bakeryId, target._id, { ...fields, purchasePricePaise, expectedVersion: target.version })
        : this.api.createMaterial(this.bakeryId, { ...fields, purchasePricePaise }));
      if (generation !== this.generation) return;
      this.materials.update(rows => target ? rows.map(row => row._id === material._id ? material : row) : [...rows, material]);
      this.materialTarget.set(null); this.materialForm = { name: '', packQuantity: '', packUom: 'g', price: '', type: 'ingredient' };
      this.notice.set('Material saved. Existing recipe revision costs are unchanged.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async loadFamily(more = false) {
    if (this.busy() || this.loading()) return;
    const recipeId = this.familyId, prior = this.detail();
    if (!more) { this.detail.set(null); this.selectedRevision.set(null); this.editing.set(null); }
    if (!recipeId) return;
    const generation = this.generation; this.loading.set(true); this.error.set('');
    try {
      const detail = await firstValueFrom(this.api.recipe(this.bakeryId, recipeId, more && prior?.nextBefore ? prior.nextBefore : undefined));
      if (generation !== this.generation || recipeId !== this.familyId) return;
      this.detail.set(more && prior ? { ...detail, revisions: [...prior.revisions, ...detail.revisions] } : detail);
      if (!more) this.selectedRevision.set(detail.revisions[0] || null);
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected selectRevision(id: string) { this.selectedRevision.set(this.detail()?.revisions.find(row => row._id === id) || null); }
  protected begin(mode: 'new' | 'revision') {
    if (this.busy() || this.loading()) return;
    const prior = mode === 'revision' ? this.selectedRevision() : null;
    if (mode === 'revision' && !prior) return;
    this.editing.set(mode); this.error.set(''); this.notice.set('');
    this.form = { name: '', category: this.detail()?.recipe.category || 'Cakes', label: '', yieldPieces: prior?.yieldPieces || 8,
      overhead: ((prior?.overheadPaise || 0) / 100).toFixed(2), notes: prior?.notes || '',
      ingredients: prior ? prior.ingredients.map(line => ({ materialId: line.materialId, quantity: line.quantity, uom: line.uom }))
        : [{ materialId: '', quantity: '', uom: 'g' }] };
  }
  protected addLine() { if (this.form.ingredients.length < 100 && !this.busy()) this.form.ingredients.push({ materialId: '', quantity: '', uom: 'g' }); }
  protected materialChosen(index: number) { const line = this.form.ingredients[index]; const material = this.materials().find(row => row._id === line.materialId); if (material) line.uom = material.packUom; }
  protected async saveRecipe() {
    const mode = this.editing(), family = this.detail()?.recipe;
    if (!mode || this.busy() || this.loading() || (mode === 'revision' && !family)) return;
    const overheadPaise = parseRupeesToPaise(this.form.overhead);
    if (overheadPaise === null) { this.error.set('Enter a valid overhead amount.'); return; }
    const materials = new Map(this.materials().map(row => [row._id, row]));
    if (this.form.ingredients.some(line => !materials.get(line.materialId)?.active)) { this.error.set('Choose an active material on every line. Load more materials if needed.'); return; }
    const data = { yieldPieces: this.form.yieldPieces, label: this.form.label, notes: this.form.notes, overheadPaise,
      ingredients: this.form.ingredients.map(line => ({ ...line, expectedVersion: materials.get(line.materialId)!.version })) };
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(mode === 'new' ? this.api.createRecipe(this.bakeryId, { ...data, name: this.form.name, category: this.form.category })
        : this.api.createRevision(this.bakeryId, family!._id, { ...data, expectedVersion: family!.version }));
      if (generation !== this.generation) return;
      this.recipes.update(rows => mode === 'new' ? [...rows, result.recipe] : rows.map(row => row._id === result.recipe._id ? result.recipe : row));
      const prior = this.detail(); this.familyId = result.recipe._id;
      this.detail.set({ recipe: result.recipe, revisions: [result.revision, ...(mode === 'revision' ? prior?.revisions || [] : [])], nextBefore: mode === 'revision' ? prior?.nextBefore || null : null });
      this.selectedRevision.set(result.revision); this.editing.set(null); this.notice.set('Recipe revision saved. Product mappings are unchanged.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async mapProduct(clear = false) {
    const product = this.products().find(row => row._id === this.mappingProductId), revision = this.selectedRevision();
    if (!product || (!clear && !revision) || this.busy() || this.loading()) return;
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      const mapping = await firstValueFrom(this.api.mapRecipe(this.bakeryId, product._id, clear ? null : revision!._id, product.version));
      if (generation !== this.generation) return;
      this.products.update(rows => rows.map(row => row._id === product._id ? { ...row, ...mapping } : row));
      this.notice.set(clear ? 'Recipe mapping removed.' : 'Selected revision linked to this product.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
