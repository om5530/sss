import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { BakeryMaterial } from '../../../../core/models/bakery.model';

interface PurchaseLine { materialId: string; quantity: string; uom: string; totalPaid: string }
interface PurchaseEntry {
  _id: string; code: string; canDelete: boolean; purchasedAt: string; supplierName: string; notes: string; totalPaid: string;
  lines: { materialName: string; quantity: string; uom: string; totalPaid: string }[];
}
interface PurchaseHistory {
  purchases: PurchaseEntry[]; total: number; page: number; pages: number;
  months: { month: string; total: string; count: number }[];
  summary: { allTime: string; thisMonth: string; thisYear: string; selectedTotal: string; count: number };
}
interface PurchasePayload { operationKey: string; purchasedAt: string; supplierName: string; lines: PurchaseLine[] }

@Component({
  selector: 'app-admin-bakery-purchasing',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-bakery-purchasing.html',
  styleUrl: './admin-bakery-purchasing.scss',
})
export class AdminBakeryPurchasing {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private historyRequest?: Subscription;
  private pendingPurchase?: PurchasePayload;
  private base = '/api/admin/bakery';
  readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  materials = signal<BakeryMaterial[]>([]);
  history = signal<PurchaseHistory | null>(null);
  loadingMaterials = signal(false);
  loadingHistory = signal(false);
  saving = signal(false);
  deletingId = signal('');
  deleteError = signal('');
  uncertainSave = signal(false);
  error = signal('');
  historyError = signal('');
  materialsError = signal('');
  notice = signal('');
  errors = signal<Record<string, string>>({});
  month = signal('');
  form = { purchasedAt: this.today, supplierName: '', lines: [this.newLine()] };
  selectedMonthLabel = computed(() => this.month() ? this.monthLabel(this.month()) : 'All time');
  availableMonths = computed(() => [...new Set([
    this.today.slice(0, 7),
    ...(this.history()?.months.map(row => row.month) || []),
    ...(this.month() ? [this.month()] : []),
  ])].sort().reverse());

  constructor() {
    this.loadMaterials();
    this.loadHistory();
    this.destroyRef.onDestroy(() => this.historyRequest?.unsubscribe());
  }
  private newLine(): PurchaseLine { return { materialId: '', quantity: '', uom: '', totalPaid: '' }; }
  loadMaterials() {
    this.loadingMaterials.set(true);
    this.materialsError.set('');
    this.http.get<{ materials: BakeryMaterial[] }>(this.base + '/materials').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.materials.set(res.materials.filter(m => m.isActive !== false && ['ingredient', 'packaging'].includes(m.type))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })));
        this.loadingMaterials.set(false);
      },
      error: () => { this.materialsError.set('Could not load materials. Please try again.'); this.loadingMaterials.set(false); },
    });
  }
  loadHistory(page = 1) {
    this.historyRequest?.unsubscribe();
    this.loadingHistory.set(true);
    this.historyError.set('');
    const params = { month: this.month(), page: String(page) };
    this.historyRequest = this.http.get<PurchaseHistory>(this.base + '/purchase-history', { params }).subscribe({
      next: (res) => { this.history.set(res); this.loadingHistory.set(false); },
      error: () => { this.historyError.set('Could not load purchase history. Please try again.'); this.loadingHistory.set(false); },
    });
  }
  filterMonth(value: string) { this.month.set(value); this.loadHistory(); }
  deletePurchase(purchase: PurchaseEntry) {
    if (this.deletingId() || !window.confirm(`Delete purchase ${purchase.code}? This will remove it from spending history and subtract its items from inventory.`)) return;
    this.deletingId.set(purchase._id);
    this.deleteError.set('');
    this.notice.set('');
    this.http.delete(this.base + '/purchases/' + purchase._id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deletingId.set('');
        this.notice.set('Purchase deleted. Spending history and inventory have been updated.');
        const page = this.history()?.page || 1;
        this.loadHistory(this.history()?.purchases.length === 1 && page > 1 ? page - 1 : page);
        this.loadMaterials();
      },
      error: (err: HttpErrorResponse) => {
        this.deletingId.set('');
        this.deleteError.set(err.error?.message || 'Could not delete the purchase. Please try again.');
      },
    });
  }
  viewMonth(value: string) {
    this.filterMonth(value);
    document.getElementById('purchase-history')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }
  material(line: PurchaseLine) { return this.materials().find(m => m._id === line.materialId); }
  units(line: PurchaseLine) {
    const m = this.material(line);
    if (!m) return [];
    const base = m.baseUom.toLowerCase();
    const mass = ['mg', 'g', 'kg'];
    const volume = ['ml', 'L'];
    if (mass.includes(base)) return m.densityGramPerMl ? [...mass, ...volume] : mass;
    if (['ml', 'l'].includes(base)) return m.densityGramPerMl ? [...volume, ...mass] : volume;
    if (['piece', 'dozen'].includes(base)) return ['piece', 'dozen'];
    return [m.baseUom];
  }
  chooseMaterial(line: PurchaseLine) {
    const m = this.material(line);
    line.uom = m && this.units(line).includes(m.packUom) ? m.packUom : m?.baseUom || '';
    this.errors.set({});
  }
  addLine() { if (this.form.lines.length < 50) this.form.lines.push(this.newLine()); }
  removeLine(index: number) { this.form.lines.splice(index, 1); this.errors.set({}); }
  totalPaid() { return this.form.lines.reduce((sum, line) => sum + (Number(line.totalPaid) || 0), 0); }
  money(value: string | number | undefined) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));
  }
  monthLabel(month: string) {
    return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(month + '-01T00:00:00Z'));
  }
  savePurchase() {
    if (this.saving()) return;
    if (!this.pendingPurchase) {
      const errors: Record<string, string> = {};
      const date = this.form.purchasedAt;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
        errors['date'] = 'Please choose a valid purchase date.';
      else if (date > this.today) errors['date'] = 'Purchase date cannot be in the future.';
      if (this.form.supplierName.length > 100) errors['supplier'] = 'Supplier must be 100 characters or fewer.';
      this.form.lines.forEach((line, i) => {
        if (!this.material(line)) errors[i + '-material'] = 'Please choose a material.';
        if (!line.quantity.trim() || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1e12)
          errors[i + '-quantity'] = 'Enter a quantity greater than zero, up to 1,000,000,000,000.';
        if (!this.units(line).includes(line.uom)) errors[i + '-unit'] = 'Please choose a unit.';
        if (!/^\d+(\.\d{1,2})?$/.test(line.totalPaid.trim()) || Number(line.totalPaid) > 1e12)
          errors[i + '-amount'] = 'Enter the total paid in rupees, with up to two decimal places. Use 0 for free items.';
      });
      this.errors.set(errors);
      if (Object.keys(errors).length) { this.error.set('Please correct the highlighted fields.'); return; }
      this.pendingPurchase = { ...this.form, lines: this.form.lines.map(l => ({ ...l })), operationKey: crypto.randomUUID() };
    }
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    this.http.post(this.base + '/purchases/record', this.pendingPurchase).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.uncertainSave.set(false);
        this.pendingPurchase = undefined;
        this.errors.set({});
        this.form = { purchasedAt: this.today, supplierName: '', lines: [this.newLine()] };
        this.notice.set('Purchase saved. The quantities have been added to inventory.');
        this.loadMaterials();
        this.loadHistory();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 0 || err.status >= 500) {
          this.uncertainSave.set(true);
          this.error.set('Could not confirm the save. Retry below; the same purchase will only be recorded once.');
        } else {
          this.pendingPurchase = undefined;
          this.uncertainSave.set(false);
          this.error.set(err.error?.message || 'Could not save the purchase. Please try again.');
        }
      },
    });
  }
}
