import { Component, inject, signal, OnInit } from '@angular/core';
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
    this.bakery.getMaterials({ type: typeParam, search: this.searchQuery() || undefined }).subscribe({
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
      currentStock: 1000,
      minimumStock: 200,
      supplierName: '',
    });
  }

  editMaterial(m: BakeryMaterial) {
    this.editingMaterial.set({ ...m });
  }

  cancelEdit() {
    this.editingMaterial.set(null);
  }

  getCalculatedPreview(): number {
    const m = this.editingMaterial();
    if (!m) return 0;
    const qty = Number(m.packQuantity) || 1;
    const price = Number(m.purchasePrice) || 0;
    return price / qty;
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
