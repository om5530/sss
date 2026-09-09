import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BakeryService } from '../../../../core/services/bakery.service';
import { BakeryMaterial, BakeryWaste } from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-bakery-waste',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './admin-bakery-waste.html',
  styleUrl: './admin-bakery-waste.scss',
})
export class AdminBakeryWaste implements OnInit {
  private bakery = inject(BakeryService);
  private toast = inject(ToastService);

  materials = signal<BakeryMaterial[]>([]);
  wasteLogs = signal<BakeryWaste[]>([]);
  todayCost = signal<number>(0);
  monthCost = signal<number>(0);
  loading = signal<boolean>(false);

  // New Waste Entry Form
  selectedMaterialId = signal<string>('');
  quantity = signal<number>(100);
  reason = signal<string>('Spoilage');
  notes = signal<string>('');

  reasons: string[] = [
    'Spoilage',
    'Dropped',
    'Burnt',
    'Overbaked',
    'Expired',
    'Trim',
    'Damaged',
    'Incorrect Recipe',
    'Unsold',
    'Other',
  ];

  ngOnInit() {
    this.fetchData();
  }

  fetchData() {
    this.loading.set(true);
    this.bakery.getMaterials().subscribe({
      next: (res) => {
        this.materials.set(res.materials);
        if (res.materials.length > 0 && !this.selectedMaterialId()) {
          this.selectedMaterialId.set(res.materials[0]._id);
        }
      },
    });

    this.bakery.getWaste().subscribe({
      next: (res) => {
        this.wasteLogs.set(res.logs);
        this.todayCost.set(res.todayCost);
        this.monthCost.set(res.monthCost);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  getSelectedMaterial(): BakeryMaterial | undefined {
    return this.materials().find((m) => m._id === this.selectedMaterialId());
  }

  getCostLostPreview(): number {
    const mat = this.getSelectedMaterial();
    if (!mat) return 0;
    return (Number(this.quantity()) || 0) * (Number(mat.effectiveUnitCost) || 0);
  }

  logWaste() {
    const mat = this.getSelectedMaterial();
    const qty = Number(this.quantity());
    if (!mat || qty <= 0) {
      this.toast.error('Please select an item and valid quantity');
      return;
    }

    const payload = {
      materialId: mat._id,
      materialName: mat.name,
      quantity: qty,
      uom: mat.baseUom,
      unitCost: mat.effectiveUnitCost,
      reason: this.reason(),
      notes: this.notes().trim(),
    };

    this.bakery.logWaste(payload).subscribe({
      next: () => {
        this.toast.success(`Logged ₹${this.getCostLostPreview().toFixed(2)} waste`);
        this.notes.set('');
        this.fetchData();
      },
      error: () => this.toast.error('Failed to log waste'),
    });
  }
}
