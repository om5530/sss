import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BakeryService } from '../../../../core/services/bakery.service';
import { BakeryMaterial, MaterialType } from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-bakery-materials',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DecimalPipe],
  templateUrl: './admin-bakery-materials.html',
  styleUrl: './admin-bakery-materials.scss',
})
export class AdminBakeryMaterials implements OnInit {
  private bakery = inject(BakeryService);
  private http = inject(HttpClient);
  private previewRequest?: Subscription;
  private previewTimer?: ReturnType<typeof setTimeout>;
  previewCost = signal<string | null>(null);
  previewError = signal('');
  saveError = signal('');
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.previewRequest?.unsubscribe();
      clearTimeout(this.previewTimer);
    });
  }
  private toast = inject(ToastService);

  materials = signal<BakeryMaterial[]>([]);
  loading = signal<boolean>(false);
  selectedType = signal<string>('all');
  searchQuery = signal<string>('');

  editingMaterial = signal<Partial<BakeryMaterial> | null>(null);
  originalStock = signal<number | null>(null);

  types: { label: string; value: string }[] = [
    { label: 'All Items', value: 'all' },
    { label: 'Ingredients', value: 'ingredient' },
    { label: 'Packaging', value: 'packaging' },
    { label: 'Equipment & Oven', value: 'resource' },
    { label: 'Labour Staff', value: 'labour' },
  ];

  readonly packUnits = [
    { value: 'mg', label: 'Milligrams (mg)' },
    { value: 'g', label: 'Grams (g)' },
    { value: 'kg', label: 'Kilograms (kg)' },
    { value: 'ml', label: 'Millilitres (ml)' },
    { value: 'L', label: 'Litres (L)' },
    { value: 'piece', label: 'Pieces' },
    { value: 'dozen', label: 'Dozens' },
    { value: 'box', label: 'Boxes' },
    { value: 'packet', label: 'Packets' },
    { value: 'minute', label: 'Minutes' },
    { value: 'hour', label: 'Hours' },
  ];

  readonly supplierOptions = [
    'Blinkit',
    'Zepto',
    'Swiggy Instamart',
    'BigBasket / BB Now',
    'Flipkart Minutes',
    'Amazon Now',
    'Amazon Fresh',
    'JioMart',
    'DMart Ready',
    'Reliance Smart Bazaar',
    'Local wholesaler',
  ];
  readonly customSupplierValue = '__custom__';
  supplierSelection = signal('');

  ngOnInit() {
    this.fetchMaterials();
  }

  fetchMaterials() {
    this.loading.set(true);
    const typeParam = this.selectedType() === 'all' ? undefined : this.selectedType();
    this.bakery
      .getMaterials({ type: typeParam, search: this.searchQuery() || undefined })
      .subscribe({
        next: (res) => {
          this.materials.set(res.materials);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  setType(t: string) {
    this.selectedType.set(t);
    this.fetchMaterials();
  }
  low(m: BakeryMaterial) {
    return Number(m.currentStock) <= Number(m.minimumStock);
  }

  private matchesCurrentView(material: BakeryMaterial) {
    const typeMatches = this.selectedType() === 'all' || material.type === this.selectedType();
    const query = this.searchQuery().trim().toLowerCase();
    return typeMatches && (!query || `${material.name} ${material.code || ''}`.toLowerCase().includes(query));
  }

  private upsertMaterial(material: BakeryMaterial) {
    const visible = this.materials().filter((item) => item._id !== material._id);
    if (material.isActive !== false && this.matchesCurrentView(material)) visible.push(material);
    visible.sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime() ||
      String(b._id).localeCompare(String(a._id)),
    );
    this.materials.set(visible);
  }

  startNewMaterial() {
    this.saveError.set('');
    this.supplierSelection.set('');
    this.originalStock.set(0);
    this.editingMaterial.set({
      name: '',
      code: 'ING-' + Date.now().toString().slice(-4),
      type: (this.selectedType() !== 'all' ? this.selectedType() : 'ingredient') as MaterialType,
      category: 'General',
      baseUom: 'g',
      packQuantity: 1000,
      packUom: 'g',
      purchasePrice: 100,
      currentStock: 0,
      minimumStock: 200,
      supplierName: '',
    });
  }

  editMaterial(m: BakeryMaterial) {
    this.saveError.set('');
    this.supplierSelection.set(
      m.supplierName && this.supplierOptions.includes(m.supplierName)
        ? m.supplierName
        : m.supplierName
          ? this.customSupplierValue
          : '',
    );
    this.originalStock.set(Number(m.currentStock));
    this.editingMaterial.set({ ...m, packUom: m.packUom === 'l' ? 'L' : m.packUom });
    this.preview();
  }

  selectSupplier(value: string) {
    this.supplierSelection.set(value);
    const material = this.editingMaterial();
    if (!material) return;
    material.supplierName = value === this.customSupplierValue ? '' : value;
  }

  onBaseUomChange(form: Partial<BakeryMaterial>, nextUom: string) {
    const previousUom = form.baseUom || nextUom;
    if (previousUom === nextUom) return;

    try {
      for (const field of ['currentStock', 'minimumStock', 'reorderLevel'] as const) {
        const value = form[field];
        if (value != null) {
          form[field] = this.convertUnitValue(
            Number(value),
            previousUom,
            nextUom,
            form.densityGramPerMl,
          );
        }
      }
      form.baseUom = nextUom;
      this.preview();
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'These units cannot be converted');
    }
  }

  private convertUnitValue(
    value: number,
    from: string,
    to: string,
    densityGramPerMl?: number,
  ) {
    const units: Record<string, { dimension: string; factor: number }> = {
      mg: { dimension: 'mass', factor: 0.001 },
      g: { dimension: 'mass', factor: 1 },
      kg: { dimension: 'mass', factor: 1000 },
      ml: { dimension: 'volume', factor: 1 },
      L: { dimension: 'volume', factor: 1000 },
      piece: { dimension: 'count', factor: 1 },
      dozen: { dimension: 'count', factor: 12 },
      minute: { dimension: 'time', factor: 1 },
      hour: { dimension: 'time', factor: 60 },
      box: { dimension: 'box', factor: 1 },
      packet: { dimension: 'packet', factor: 1 },
    };
    const source = units[from];
    const target = units[to];
    if (!source || !target) throw new Error('Unsupported unit conversion');

    let baseValue = value * source.factor;
    if (source.dimension !== target.dimension) {
      if (
        !['mass', 'volume'].includes(source.dimension) ||
        !['mass', 'volume'].includes(target.dimension) ||
        !densityGramPerMl
      ) {
        throw new Error('Choose a compatible unit, or enter density for mass/volume conversion');
      }
      baseValue = source.dimension === 'mass'
        ? baseValue / densityGramPerMl
        : baseValue * densityGramPerMl;
    }
    return Number((baseValue / target.factor).toPrecision(12));
  }

  cancelEdit() {
    this.saveError.set('');
    this.editingMaterial.set(null);
  }

  preview() {
    clearTimeout(this.previewTimer);
    this.previewRequest?.unsubscribe();
    this.previewCost.set(null);
    this.previewError.set('');
    this.previewTimer = setTimeout(() => {
      this.previewRequest = this.http
        .post<any>('/api/admin/bakery/materials/preview', this.editingMaterial())
        .subscribe({
          next: (r) => this.previewCost.set(r.unitCost),
          error: (e) => this.previewError.set(e.error?.message || 'Check pack quantity and units'),
        });
    }, 250);
  }

  saveMaterial() {
    const m = this.editingMaterial();
    this.saveError.set('');
    if (!m || !m.name?.trim()) {
      const message = 'Material name is required';
      this.saveError.set(message);
      this.toast.error(message);
      return;
    }

    if (m._id) {
      this.bakery.updateMaterial(m._id, {
        ...m,
        expectedStock: this.originalStock() ?? undefined,
      }).subscribe({
        next: (res) => {
          this.toast.success('Material updated');
          this.editingMaterial.set(null);
          this.upsertMaterial(res.material);
        },
        error: (error) => this.showSaveError(error, 'Failed to update material'),
      });
    } else {
      this.bakery.createMaterial(m).subscribe({
        next: (res) => {
          this.toast.success('Material created');
          this.editingMaterial.set(null);
          this.upsertMaterial(res.material);
        },
        error: (error) => this.showSaveError(error, 'Failed to create material'),
      });
    }
  }

  private showSaveError(error: any, fallback: string) {
    const details = error?.error?.details
      ?.map((detail: { message?: string }) => detail.message)
      .filter(Boolean)
      .join(' ');
    const message = details || error?.error?.message || fallback;
    this.saveError.set(message);
    this.toast.error(message);
  }

  deleteMaterial(id: string) {
    if (!confirm('Archive this material?')) return;
    this.bakery.deleteMaterial(id).subscribe({
      next: (res) => {
        this.toast.success('Material archived');
        this.upsertMaterial(res.material);
      },
      error: () => this.toast.error('Failed to archive material'),
    });
  }
}
