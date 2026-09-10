import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-bakery-operations',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './bakery-operations.html',
  styleUrl: './bakery-operations.scss',
})
export class BakeryOperations {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  base = '/api/admin/bakery';
  view = this.route.snapshot.data['bakeryView'] || 'dashboard';
  title: Record<string, string> = {
    dashboard: 'Bakery overview',
    production: 'Production',
    purchasing: 'Purchasing',
    reports: 'Operations reports',
    migration: 'Import materials',
  };
  busy = signal(false);
  error = signal('');
  notice = signal('');
  data = signal<any>({});
  purchasing = signal<any>({ suppliers: [], formats: [], purchases: [], prices: [] });
  materials = signal<any[]>([]);
  sheets = signal<any[]>([]);
  supplier = { name: '', contact: '', notes: '' };
  format: any = {
    materialId: '',
    supplierId: '',
    packQuantity: '1',
    packUom: 'kg',
    purchasePrice: '',
    minimumOrderPacks: '1',
    leadTimeDays: 0,
    preferred: false,
  };
  priceForm: any = {
    formatId: '',
    purchasePrice: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
  };
  purchaseForm: any = { supplierId: '', lines: [{ formatId: '', packs: '1' }], notes: '' };
  receiving: any = null;
  completing: any = null;
  comparison: any = null;
  history: any = null;
  from = '';
  to = '';
  reportTab = 'recipes';
  importText = '';
  suggestions: any[] = [];
  ngOnInit() {
    this.load();
  }
  load() {
    this.busy.set(true);
    this.error.set('');
    const params: any = {};
    if (this.from) params.from = this.from;
    if (this.to) params.to = this.to;
    forkJoin({
      report: this.http.get<any>(this.base + '/reports', { params }),
      purchasing: this.http.get<any>(this.base + '/purchasing'),
      materials: this.http.get<any>(this.base + '/materials'),
      sheets: this.http.get<any>(this.base + '/costing-sheets'),
    }).subscribe({
      next: (r) => {
        this.data.set(r.report);
        this.purchasing.set(r.purchasing);
        this.materials.set(r.materials.materials);
        this.sheets.set(r.sheets.sheets);
        this.busy.set(false);
      },
      error: (e) => {
        this.error.set(e.error?.message || 'Could not load bakery operations');
        this.busy.set(false);
      },
    });
  }
  post(path: string, body: any, message: string, done?: (r: any) => void) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.http.post<any>(this.base + path, body).subscribe({
      next: (r) => {
        done?.(r);
        this.notice.set(message);
        this.load();
      },
      error: (e) => {
        this.error.set(e.error?.message || 'Could not save. Please retry.');
        this.busy.set(false);
      },
    });
  }
  money(v: any) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
      Number(v || 0),
    );
  }
  number(v: any) {
    return Number(v || 0);
  }
  name(id: string) {
    return this.materials().find((m) => m._id === id)?.name || id;
  }
  supplierName(id: string) {
    return this.purchasing().suppliers.find((s: any) => s._id === id)?.name || '';
  }
  formatsForSupplier() {
    return this.purchasing().formats.filter(
      (f: any) => f.supplierId === this.purchaseForm.supplierId,
    );
  }
  lowStock() {
    return (this.data().stock || []).filter(
      (m: any) =>
        this.number(m.currentStock) - this.number(m.allocatedStock) <=
        (this.number(m.reorderLevel) || this.number(m.minimumStock)),
    );
  }
  saveSupplier() {
    this.post(
      '/suppliers',
      this.supplier,
      'Supplier added',
      () => (this.supplier = { name: '', contact: '', notes: '' }),
    );
  }
  saveFormat() {
    this.post('/formats', this.format, 'Purchase format added');
  }
  savePrice() {
    this.post(
      '/formats/' + this.priceForm.formatId + '/prices',
      this.priceForm,
      'Price recorded. Projected recipe costs now use the effective price.',
    );
  }
  createPurchase() {
    this.post(
      '/purchases',
      this.purchaseForm,
      'Draft purchase created',
      () =>
        (this.purchaseForm = { supplierId: '', lines: [{ formatId: '', packs: '1' }], notes: '' }),
    );
  }
  beginReceipt(p: any) {
    this.receiving = {
      purchase: p,
      operationKey: crypto.randomUUID(),
      lines: p.lines
        .filter((l: any) => Number(l.packs) > Number(l.received))
        .map((l: any) => ({
          ...l,
          packs: String(Number(l.packs) - Number(l.received)),
          lot: '',
          expiry: '',
        })),
    };
  }
  receive() {
    this.post(
      '/purchases/' + this.receiving.purchase._id + '/receive',
      { ...this.receiving, lines: this.receiving.lines.filter((l: any) => Number(l.packs) > 0) },
      'Goods received and stock updated',
      () => (this.receiving = null),
    );
  }
  beginBatch(s: any) {
    this.completing = {
      sheet: s,
      operationKey: crypto.randomUUID(),
      ingredients: s.snapshot.requirements
        .filter((r: any) => ['ingredient', 'packaging'].includes(r.itemType))
        .map((r: any) => ({ ...r })),
      outputs: s.snapshot.products.map((p: any) => ({
        lineId: p.lineId,
        recipeId: p.recipeId,
        recipeName: p.recipeName,
        quantity: p.targetUnits,
        planned: p.targetUnits,
        uom: p.yieldUom,
        waste: '0',
      })),
      notes: '',
    };
  }
  complete() {
    this.post(
      '/costing-sheets/' + this.completing.sheet._id + '/complete',
      this.completing,
      'Production completed and actual consumption recorded',
      () => (this.completing = null),
    );
  }
  compare(s: any) {
    this.error.set('');
    this.http.get<any>(this.base + '/costing-sheets/' + s._id + '/recalculate').subscribe({
      next: (r) => (this.history = r),
      error: (e) => this.error.set(e.error?.message || 'Cannot recalculate'),
    });
  }
  requirements(s: any) {
    this.error.set('');
    this.http
      .post<any>(this.base + '/purchase-requirements', { items: s.items, excludePlanId: s._id })
      .subscribe({
        next: (r) => (this.comparison = r.requirements),
        error: (e) => this.error.set(e.error?.message || 'Cannot calculate requirements'),
      });
  }
  print() {
    window.print();
  }
  printBatch(id: string) {
    const batch = document.getElementById('batch-' + id);
    if (!batch) return;
    const closed = Array.from(batch.querySelectorAll('details:not([open])'));
    closed.forEach((d) => d.setAttribute('open', ''));
    batch.classList.add('printing-batch');
    document.body.classList.add('printing-prep');
    try {
      window.print();
    } finally {
      closed.forEach((d) => d.removeAttribute('open'));
      batch.classList.remove('printing-batch');
      document.body.classList.remove('printing-prep');
    }
  }
  previewImport() {
    const items = this.importText
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const [name, cost] = l.split('|');
        return { name: name.trim(), cost: cost?.trim() };
      });
    this.http.post<any>(this.base + '/migration/preview', { items }).subscribe({
      next: (r) => (this.suggestions = r.suggestions),
      error: (e) => this.error.set(e.error?.message || 'Cannot preview import'),
    });
  }
  importOne(row: any) {
    this.post(
      '/materials',
      { ...row, type: 'ingredient', category: 'Imported', currentStock: '0' },
      'Reviewed material imported',
      () => (this.suggestions = this.suggestions.filter((r) => r !== row)),
    );
  }
}
