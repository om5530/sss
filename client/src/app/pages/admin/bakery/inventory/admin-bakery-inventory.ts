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
  sortOrder = signal<'name' | 'stock-asc' | 'stock-desc'>('name');
  filterType = signal<'all' | 'low' | 'ingredient' | 'packaging'>('all');
  recentlyAdjusted = signal<Record<string, { type: 'inc' | 'dec'; label: string }>>({});

  filteredMaterials = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.filterType();
    const sort = this.sortOrder();
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
    }).sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (sort === 'name') return byName;
      const byStock = Number(a.currentStock ?? 0) - Number(b.currentStock ?? 0);
      return (sort === 'stock-asc' ? byStock : -byStock) || byName;
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

  private applyStock(material: BakeryMaterial) {
    this.materials.update((items) => {
      const updated = items.map((item) => item._id === material._id
        ? {
            ...item,
            ...material,
            allocatedStock: item.allocatedStock,
            available: Math.max(0, Number(material.currentStock) - Number(item.allocatedStock || 0)),
          }
        : item);
      this.lowStockCount.set(updated.filter((item) => this.low(item)).length);
      return updated;
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
        this.applyStock(res.material);
        this.toast.success(`Updated ${m.name} stock (${label})`);
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
        this.applyStock(res.material);
        this.toast.success(`Stock set to ${res.material.currentStock} ${m.baseUom}`);
        this.recentlyAdjusted.update((prev) => ({
          ...prev,
          [m._id]: { type: 'inc', label: `Set: ${res.material.currentStock}` },
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
