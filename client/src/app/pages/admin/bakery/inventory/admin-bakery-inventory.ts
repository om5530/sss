import { Component, inject, signal, computed, OnInit } from '@angular/core';
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
  searchQuery = signal<string>('');
  filterType = signal<'all' | 'low' | 'ingredient' | 'packaging'>('all');
  recentlyAdjusted = signal<Record<string, { type: 'inc' | 'dec'; label: string }>>({});

  filteredMaterials = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.filterType();
    return this.materials().filter((m) => {
      if (filter === 'low' && !this.low(m)) return false;
      if (filter === 'ingredient' && m.type !== 'ingredient') return false;
      if (filter === 'packaging' && m.type !== 'packaging') return false;
      if (!q) return true;
      return (
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.code && m.code.toLowerCase().includes(q)) ||
        (m.supplierName && m.supplierName.toLowerCase().includes(q)) ||
        (m.brand && m.brand.toLowerCase().includes(q))
      );
    });
  });

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
    const isInc = amount > 0;
    const type = isInc ? 'inc' : 'dec';
    const delta = amount * (m.packQuantity || 1);
    const label = isInc ? `+${delta} ${m.baseUom}` : `${delta} ${m.baseUom}`;

    // Haptic vibration feedback
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (isInc) navigator.vibrate([28]);
        else navigator.vibrate([20, 30, 20]);
      } catch {}
    }

    // Visual micro-feedback flyout and row highlight
    this.recentlyAdjusted.update((prev) => ({
      ...prev,
      [m._id]: { type, label },
    }));

    setTimeout(() => {
      this.recentlyAdjusted.update((prev) => {
        const next = { ...prev };
        delete next[m._id];
        return next;
      });
    }, 1300);

    this.bakery.adjustStock(m._id, amount).subscribe({
      next: (res) => {
        m.currentStock = res.material.currentStock;
        this.toast.success(`Updated ${m.name} stock (${label})`);
        this.fetchInventory();
      },
      error: () => {
        this.toast.error('Failed to update stock');
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate([60, 40, 100]); } catch {}
        }
      },
    });
  }

  setStock(m: BakeryMaterial, newStock: number) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([25]); } catch {}
    }

    this.bakery.updateStock(m._id, Number(newStock), m.currentStock).subscribe({
      next: (res) => {
        m.currentStock = res.material.currentStock;
        this.toast.success(`Stock set to ${m.currentStock} ${m.baseUom}`);
        this.recentlyAdjusted.update((prev) => ({
          ...prev,
          [m._id]: { type: 'inc', label: `Set: ${m.currentStock}` },
        }));
        setTimeout(() => {
          this.recentlyAdjusted.update((prev) => {
            const next = { ...prev };
            delete next[m._id];
            return next;
          });
        }, 1200);
      },
      error: (e) => {
        this.toast.error(e.error?.message || 'Failed to set stock');
        this.fetchInventory();
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate([60, 40, 100]); } catch {}
        }
      },
    });
  }
  low(m: BakeryMaterial) {
    return (
      Number(m.available ?? m.currentStock) <=
      (Number(m.reorderLevel) || Number(m.minimumStock) || 0)
    );
  }
}
