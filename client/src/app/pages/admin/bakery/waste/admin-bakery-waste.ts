import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
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
  private http = inject(HttpClient);
  batches = signal<any[]>([]);
  finished: any = { productionId: '', recipeId: '', quantity: '1', reason: 'Unsold' };
  outputs() {
    return this.batches().find((b) => b._id === this.finished.productionId)?.actual.outputs || [];
  }
  saving = signal(false);
  logFinished() {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post('/api/admin/bakery/waste', this.finished).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Finished product waste recorded');
        this.fetchData();
      },
      error: (e: any) => {
        this.saving.set(false);
        this.toast.error(e.error?.message || 'Could not record waste');
      },
    });
  }
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
    this.http
      .get<any>('/api/admin/bakery/costing-sheets')
      .subscribe({
        next: (r) => this.batches.set(r.sheets.filter((s: any) => s.status === 'completed')),
      });
    this.loading.set(true);
    this.bakery.getMaterials().subscribe({
      next: (res) => {
        this.materials.set(
          res.materials.filter((m) => ['ingredient', 'packaging'].includes(m.type)),
        );
        if (this.materials().length > 0 && !this.selectedMaterialId()) {
          this.selectedMaterialId.set(this.materials()[0]._id);
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

  logWaste() {
    if (this.saving()) return;
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

    this.saving.set(true);
    this.bakery.logWaste(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Waste recorded. Its calculated cost is shown in the log.');
        this.notes.set('');
        this.fetchData();
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error(e.error?.message || 'Failed to log waste');
      },
    });
  }
}
