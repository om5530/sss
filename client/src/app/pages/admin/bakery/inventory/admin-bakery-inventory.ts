import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BakeryService } from '../../../../core/services/bakery.service';
import { BakeryMaterial } from '../../../../core/models/bakery.model';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-admin-bakery-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-bakery-inventory.html',
  styleUrl: './admin-bakery-inventory.scss',
})
export class AdminBakeryInventory implements OnInit {
  private bakery = inject(BakeryService);
  private toast = inject(ToastService);

  materials = signal<BakeryMaterial[]>([]);
  lowStockCount = signal<number>(0);
  loading = signal<boolean>(false);

  ngOnInit() {
    this.fetchInventory();
  }

  fetchInventory() {
    this.loading.set(true);
    this.bakery.getInventory().subscribe({
      next: (res) => {
        this.materials.set(res.materials);
        this.lowStockCount.set(res.lowStockCount);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  quickAdjust(m: BakeryMaterial, amount: number) {
    const newStock = Math.max(0, m.currentStock + amount);
    this.bakery.updateStock(m._id, newStock).subscribe({
      next: (res) => {
        m.currentStock = res.material.currentStock;
        this.toast.success(`Updated ${m.name} stock`);
      },
      error: () => this.toast.error('Failed to update stock'),
    });
  }

  setStock(m: BakeryMaterial, newStock: number) {
    this.bakery.updateStock(m._id, Number(newStock)).subscribe({
      next: (res) => {
        m.currentStock = res.material.currentStock;
        this.toast.success(`Stock set to ${m.currentStock} ${m.baseUom}`);
      },
      error: () => this.toast.error('Failed to set stock'),
    });
  }
}
