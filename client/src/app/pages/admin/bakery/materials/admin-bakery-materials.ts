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

  types: { label: string; value: string }[] = [
    { label: 'All Items', value: 'all' },
    { label: 'Ingredients', value: 'ingredient' },
    { label: 'Packaging', value: 'packaging' },
    { label: 'Equipment & Oven', value: 'resource' },
    { label: 'Labour Staff', value: 'labour' },
  ];

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

  startNewMaterial() {
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
    this.editingMaterial.set({ ...m });
    this.preview();
  }

  cancelEdit() {
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
    if (!m || !m.name?.trim()) {
      this.toast.error('Material name is required');
      return;
    }

    if (m._id) {
      this.bakery.updateMaterial(m._id, m).subscribe({
        next: () => {
          this.toast.success('Material updated');
          this.editingMaterial.set(null);
          this.fetchMaterials();
        },
        error: () => this.toast.error('Failed to update material'),
      });
    } else {
      this.bakery.createMaterial(m).subscribe({
        next: () => {
          this.toast.success('Material created');
          this.editingMaterial.set(null);
          this.fetchMaterials();
        },
        error: () => this.toast.error('Failed to create material'),
      });
    }
  }

  deleteMaterial(id: string) {
    if (!confirm('Archive this material?')) return;
    this.bakery.deleteMaterial(id).subscribe({
      next: () => {
        this.toast.success('Material archived');
        this.fetchMaterials();
      },
      error: () => this.toast.error('Failed to archive material'),
    });
  }
}
