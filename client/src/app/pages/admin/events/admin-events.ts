import { QuantityCaret } from '../shared/quantity-caret';
import { BusyButton } from '../shared/busy-button';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { EventPlan, EventPlanItem, EventPreparationProduct, EventSalesReport, EventSummary } from '../../../core/models/admin.model';
import { downloadCsv } from '../shared/admin-ui';
import { ConfirmModal } from '../shared/confirm-modal';
import { AdminProductListState } from '../shared/admin-product-list-state';

@Component({ selector: 'app-admin-events', imports: [QuantityCaret, BusyButton, RouterLink, FormsModule, DatePipe, ConfirmModal],
  templateUrl: './admin-events.html', styleUrl: './admin-events.scss' })
export class AdminEvents {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private productList = inject(AdminProductListState);
  private version = 0;
  private editorVersion = 0;
  private loadedEventName = '';
  private readonly eventStorageKey = 'bc_admin_events_event';
  protected readonly figuresVisible = signal(false);
  protected toggleFigures() { this.figuresVisible.update(visible => !visible); }
  protected money(value: number | null) { return this.figuresVisible() ? this.rupees(value) : '••••'; }
  protected count(value: number | null) { return this.figuresVisible() ? (value === null ? 'Not set' : String(value)) : '••••'; }
  protected readonly report = signal<EventSalesReport | null>(null);
  protected readonly names = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly editor = signal(false);
  protected readonly editorLoading = signal(false);
  protected readonly editorFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly products = signal<EventPreparationProduct[]>([]);
  protected readonly lines = signal<EventPlanItem[]>([]);
  protected readonly confirmation = signal<{ event: EventSummary; action: 'close' | 'reopen' } | null>(null);
  protected eventName = '';
  protected selectedProduct = '';
  protected draft = this.blank();
  private editing: EventPlan | null = null;
  private editingSummary: EventSummary | undefined;

  constructor() {
    const hideOnLeave = () => { if (document.hidden) this.figuresVisible.set(false); };
    document.addEventListener('visibilitychange', hideOnLeave);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', hideOnLeave));
    let firstVisit = true;
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const restoreSelection = firstVisit && !params.has('eventName');
      firstVisit = false;
      this.eventName = params.get('eventName') ?? '';
      try {
        if (restoreSelection) this.eventName = localStorage.getItem(this.eventStorageKey) ?? '';
        localStorage.setItem(this.eventStorageKey, this.eventName);
      } catch { /* Filtering still works when browser storage is unavailable. */ }
      if (restoreSelection && this.eventName) {
        this.router.navigate([], { relativeTo: this.route, queryParams: { eventName: this.eventName }, queryParamsHandling: 'merge', replaceUrl: true });
        return;
      }
      this.load();
    });
  }
  private localDate(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  private blank() {
    const today = this.localDate();
    return { eventName: '', startDate: today, endDate: today, rent: 0, travelCost: 0, extraCost: 0, extraCostNote: '' };
  }
  protected load() {
    const version = ++this.version;
    const selectedEvent = this.eventName;
    this.loading.set(true); this.failed.set(false);
    this.admin.eventSales(selectedEvent || undefined).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (report) => {
        if (version !== this.version) return;
        this.names.set(report.eventNames); this.report.set(report);
        this.loadedEventName = selectedEvent; this.loading.set(false);
      },
      error: () => { if (version === this.version) { this.failed.set(true); this.loading.set(false); } },
    });
  }
  protected apply() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { eventName: this.eventName || null } });
  }
  protected selectEvent(event: EventSummary) { this.eventName = event.eventName; this.apply(); }
  protected selectedEvent() {
    return this.eventName ? this.report()?.events.find((e) => e.eventName.toLowerCase() === this.eventName.toLowerCase()) : undefined;
  }
  protected sum(field: 'revenue' | 'units' | 'paidOrders') {
    return this.report()?.events.reduce((total, event) => total + event[field], 0) || 0;
  }
  protected begin(event?: EventSummary) {
    if (this.saving()) return;
    this.editingSummary = event; this.editing = null;
    const version = ++this.editorVersion;
    this.editor.set(true); this.editorLoading.set(true); this.editorFailed.set(false); this.error.set('');
    this.lines.set([]); this.selectedProduct = ''; this.draft = this.blank();
    if (event) {
      this.draft.eventName = event.eventName;
      this.draft.startDate = event.startDate || (event.lastSaleAt ? this.localDate(new Date(event.lastSaleAt)) : this.draft.startDate);
      this.draft.endDate = event.endDate || this.draft.startDate;
    }
    forkJoin({ products: this.admin.eventPreparationProducts(), plan: event?.planId ? this.admin.eventPlan(event.planId) : of(null) })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ products, plan }) => {
          if (version !== this.editorVersion) return;
          this.products.set(products); this.editing = plan;
          if (plan) {
            this.draft = { eventName: plan.eventName, startDate: plan.startDate, endDate: plan.endDate,
              rent: plan.rent, travelCost: plan.travelCost, extraCost: plan.extraCost, extraCostNote: plan.extraCostNote };
            this.lines.set(plan.items.map((i) => ({ ...i })));
          }
          this.editorLoading.set(false);
          setTimeout(() => document.getElementById('event-editor-title')?.focus(), 0);
        },
        error: () => { if (version === this.editorVersion) { this.editorLoading.set(false); this.editorFailed.set(true); } },
      });
  }
  protected retryEditor() { this.begin(this.editingSummary); }
  protected dismissEditor() { if (!this.saving()) { ++this.editorVersion; this.editor.set(false); this.error.set(''); } }
  protected existingName() { return !!this.editing || !!this.editingSummary; }
  protected choices() { return this.products().filter((p) => !this.lines().some((line) => line.productId === p._id)); }
  protected addProduct(productId: string) {
    this.selectedProduct = productId;
    const product = this.products().find((p) => p._id === productId);
    if (!product || product.unitCost === null || this.lines().length >= 100 || this.lines().some((i) => i.productId === product._id)) return;
    const stock = this.stockRow(product._id);
    this.lines.update((items) => [{ productId: product._id, name: product.name, prepared: 1, wasted: 0, reusable: 0, returned: 0,
      unitCost: product.unitCost, stockOut: (stock?.sold || 0) + (stock?.unpaidHandovers || 0) + (stock?.refundedHandovers || 0),
      refundedHandovers: stock?.refundedHandovers || 0 }, ...items]);
    this.selectedProduct = '';
  }
  protected removeProduct(id: string) { this.lines.update((items) => items.filter((i) => i.productId !== id)); }
  protected stockRow(id: string) { return this.report()?.stock.find((p) => p.productId === id && p.eventName.toLowerCase() === this.draft.eventName.toLowerCase()); }
  private stockOutFor(line: EventPlanItem) {
    const stock = !this.editing ? this.stockRow(line.productId) : undefined;
    return stock ? stock.sold + stock.unpaidHandovers + stock.refundedHandovers : line.stockOut;
  }
  protected minimumPrepared(line: EventPlanItem) { return Math.max(1, this.stockOutFor(line) - (line.returned || 0) + (line.reusable || 0)); }
  protected reusableLimit(line: EventPlanItem) { return Math.max(0, (line.prepared || 0) - this.stockOutFor(line) + (line.returned || 0)); }
  protected wastedPieces(line: EventPlanItem) { return Math.max(0, this.reusableLimit(line) - (line.reusable || 0)); }
  protected netReason(event?: EventSummary): string {
    if (!event) {
      const pending = this.report()?.events.find((e) => e.netProfit === null);
      return pending ? this.netReason(pending) : 'Enter prepared quantities';
    }
    if (!event.planId || this.report()?.stock.some((p) => p.eventName === event.eventName && p.prepared === null)) return 'Enter prepared quantities';
    if (!event.stockReconciled) return 'Check reusable quantities';
    return 'Check recipe costs';
  }
  protected save(form: NgForm) {
    if (form.invalid || this.saving()) { form.control.markAllAsTouched(); return; }
    this.saving.set(true); this.error.set('');
    this.admin.saveEventPlan({ ...this.draft, version: this.editing?.version,
      items: this.lines().map((i) => ({ productId: i.productId, prepared: i.prepared, wasted: this.wastedPieces(i), reusable: i.reusable, returned: i.returned })) }, this.editing?._id)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (plan) => {
          this.productList.clear();
          this.saving.set(false); this.editor.set(false); ++this.editorVersion;
          this.toast.success('Event preparation and expenses saved');
          if (this.eventName === plan.eventName) this.load();
          else { this.eventName = plan.eventName; this.apply(); }
        },
        error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'Could not save the event. Please try again.'); },
      });
  }
  protected closeReason(event: EventSummary) {
    if (event.openOrders) return 'Complete or cancel remaining orders before closing.';
    if (this.report()?.stock.some((p) => p.eventName === event.eventName && p.unpaidHandovers > 0)) return 'Settle unpaid handovers before closing.';
    if (!event.stockReconciled) return 'Enter prepared quantities for every product and check reusable counts before closing.';
    if (event.netProfit === null) return 'Resolve missing recipe costs before closing.';
    return '';
  }
  protected requestLifecycle(event: EventSummary, action: 'close' | 'reopen') { this.error.set(''); this.confirmation.set({ event, action }); }
  protected confirmationMessage() {
    const pending = this.confirmation(); if (!pending) return '';
    return pending.action === 'close'
      ? `Save the final report for ${pending.event.eventName} with net profit ${this.money(pending.event.netProfit)}? Reopen the event whenever you need to correct stock, expenses or orders.`
      : `Reopen ${pending.event.eventName} to correct its stock, expenses or orders? Its report will use the updated figures until you close it again.`;
  }
  protected lifecycle() {
    const pending = this.confirmation();
    if (!pending?.event.planId || pending.event.version === null || this.saving()) return;
    this.saving.set(true);
    const request = pending.action === 'close' ? this.admin.closeEvent(pending.event.planId, pending.event.version, pending.event.revision)
      : this.admin.reopenEvent(pending.event.planId, pending.event.version);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.saving.set(false); this.confirmation.set(null); this.toast.success(pending.action === 'close' ? 'Event closed. Final report saved.' : 'Event reopened for corrections'); this.load(); },
      error: (err) => { this.saving.set(false); this.confirmation.set(null); this.error.set(err.error?.message || 'Could not update the event. Refresh and try again.'); this.load(); },
    });
  }
  protected rupees(value: number | null) { return value === null ? 'Not set' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value); }
  protected unitsLeft(product: EventSalesReport['products'][number]) { return product.totalUnits === null ? null : product.totalUnits - product.quantity; }
  protected export() {
    if (this.loading() || this.failed() || this.loadedEventName !== this.eventName) return;
    const report = this.report(); if (!report) return;
    const events = report.events.filter((e) => !this.eventName || e.eventName.toLowerCase() === this.eventName.toLowerCase());
    const suffix = this.eventName ? this.eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'all-events';
    const value = (n: number | null) => n === null ? 'Not set' : n;
    const rows: (string | number)[][] = events.map((e) => [e.eventName, e.status, e.startDate, e.endDate, e.orders, e.paidOrders,
      e.units, e.revenue, value(e.cost), value(e.profit), value(e.wastageCost), value(e.rent), value(e.travelCost), value(e.extraCost),
      e.extraCostNote, value(e.netProfit), value(e.preparedCost), value(e.reusableValue), e.cash, e.upi,
      e.cost === null ? 'Recipe not linked' : e.costEstimated ? 'Includes estimates' : 'Recorded at sale', e.closedAt || '', e.changedSinceClose ? 'Orders changed; reopen to refresh' : '']);
    if (report.stock.length) {
      rows.push([], ['Stock by product'], ['Event', 'Product', 'Wasted', 'Reusable', 'Wasted stock cost INR', 'Unpaid handovers', 'Refunded handovers', 'Returned refunded pieces', 'Handover loss cost INR', 'Reusable stock value INR']);
      rows.push(...report.stock.map((p) => [p.eventName, p.name, p.wasted, p.reusable, value(p.wastageCost), p.unpaidHandovers, p.refundedHandovers, p.returned,
        value(p.handoverLossCost), value(p.reusableValue)]));
    }
    rows.push([], ['Products sold'], ['Product', 'Total units prepared', 'Paid units sold', 'Units left', 'Cost of total units INR', 'Cost of sold units INR', 'Product subtotal INR', 'Profit or loss INR']);
    rows.push(...report.products.map((p) => [p.name, value(p.totalUnits), p.quantity, value(this.unitsLeft(p)), value(p.totalCost), value(p.cost), p.subtotal, value(p.profit)]));
    downloadCsv(`event-sales-${suffix}.csv`, ['Event', 'Status', 'Start date', 'End date', 'Orders', 'Paid orders', 'Units sold', 'Paid sales INR',
      'Cost of sold items INR', 'Profit INR', 'Wastage and loss cost INR', 'Rent INR', 'Car or travel cost INR', 'Extra cost INR', 'Extra cost note',
      'Net profit INR', 'Prepared stock cost INR', 'Reusable stock value INR', 'Cash INR', 'UPI INR', 'Sale cost basis', 'Closed at', 'Report notice'], rows);
  }
}
