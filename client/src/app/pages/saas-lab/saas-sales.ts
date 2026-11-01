import { SaasAccountState } from '../../core/services/saas-account-state.service';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { SaasService } from '../../core/services/saas.service';
import { SaasProduct } from '../../core/models/saas-product.model';
import { SaasEvent, SaasEventReport, SaasOrder, SaasPaymentMethod, SaasSaleInput, SaasRefundInput, SaasPaymentEntry, SaasOrderChange } from '../../core/models/saas-sales.model';
import { parseRupeesToPaise } from '../../core/utils/saas-money';
import { PendingRefund, loadPendingRefund, savePendingRefund, clearPendingRefund } from '../../core/utils/saas-refund-recovery';
import { clearPendingSale, loadPendingSale, savePendingSale } from '../../core/utils/saas-sale-recovery';

@Component({ selector: 'app-saas-sales', imports: [FormsModule, CurrencyPipe, DatePipe], templateUrl: './saas-sales.html', styleUrl: './saas-lab.scss' })
export class SaasSales implements OnChanges, OnDestroy, AfterViewChecked {
  @Input({ required: true }) bakeryId!: string;
  @Input({ required: true }) role!: 'owner' | 'staff';
  @ViewChild('confirmDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private readonly workspaceAccount = inject(SaasAccountState, { optional: true });
  private readonly auth = inject(AuthService);
  private generation = 0;
  private orderRequest = 0;
  private financeRequest = 0;
  private historyRequest = 0;
  private readonly onVisibility = () => { if (document.hidden) { this.hideFinances(); if (this.adjusting()?.mode === 'history') this.resetAdjustment(); } };
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly products = signal<SaasProduct[]>([]);
  protected readonly events = signal<SaasEvent[]>([]);
  protected readonly orders = signal<SaasOrder[]>([]);
  protected readonly productCursor = signal<string | null>(null);
  protected readonly eventCursor = signal<string | null>(null);
  protected readonly orderCursor = signal<string | null>(null);
  protected readonly pendingRefund = signal<PendingRefund | null>(null);
  protected readonly refundRecoveryBlocked = signal(false);
  protected readonly reviewingRefundRecovery = signal(false);
  protected readonly pending = signal<SaasSaleInput | null>(null);
  protected readonly recoveryBlocked = signal(false);
  protected readonly reviewing = signal<SaasSaleInput | null>(null);
  protected readonly pickupUpdate = signal<{ order: SaasOrder; status: 'ready' | 'collected' } | null>(null);
  protected readonly cancellingPickup = signal<SaasOrder | null>(null);
  protected readonly expiringPickups = signal(false);
  protected pickupCancelReason = '';
  protected readonly settling = signal<SaasOrder | null>(null);
  protected readonly adjusting = signal<{ order: SaasOrder; mode: 'discount' | 'refund' | 'history' } | null>(null);
  protected readonly payments = signal<SaasPaymentEntry[]>([]);
  protected readonly changes = signal<SaasOrderChange[]>([]);
  protected readonly paymentHistoryCursor = signal<string | null>(null);
  protected readonly changeHistoryCursor = signal<string | null>(null);
  protected readonly historyLoading = signal(false);
  protected adjustmentForm = { discount: '0', comment: '', reason: '', method: 'cash' as SaasPaymentMethod };
  protected refundAttempt: SaasRefundInput | null = null;
  protected readonly closing = signal<SaasEvent | null>(null);
  protected readonly finances = signal<SaasEventReport | null>(null);
  protected readonly financeLoading = signal(false);
  protected eventId = '';
  protected receivedMethod: SaasPaymentMethod = 'cash';
  protected form = { items: [{ productId: '', quantity: 1 }], discount: '0', status: 'paid' as 'paid' | 'unpaid', method: 'cash' as SaasPaymentMethod, comment: '' };
  protected eventForm = { name: '', key: '', rent: '0', travel: '0', extra: '0' };

  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() {
    this.generation++; this.orderRequest++; this.hideFinances();
    this.products.set([]); this.events.set([]); this.orders.set([]); this.pending.set(null);
    this.productCursor.set(null); this.eventCursor.set(null); this.orderCursor.set(null);
    this.reviewing.set(null); this.settling.set(null); this.closing.set(null); this.eventId = '';
    this.receivedMethod = 'cash'; this.pickupUpdate.set(null); this.cancellingPickup.set(null); this.expiringPickups.set(false); this.resetAdjustment();
    this.form = { items: [{ productId: '', quantity: 1 }], discount: '0', status: 'paid', method: 'cash', comment: '' };
    this.eventForm = { name: '', key: '', rent: '0', travel: '0', extra: '0' }; this.notice.set(''); this.error.set(''); this.busy.set(false);
    try {
      const actorId = (this.workspaceAccount?.account()?.id || this.auth.user()?.id);
      if (!actorId) throw new Error('Sign in before opening this workspace.');
      const pending = loadPendingSale(globalThis.sessionStorage, actorId, this.bakeryId);
      this.pending.set(pending); this.recoveryBlocked.set(false); if (pending) this.eventId = pending.eventId || '';
    } catch { this.recoveryBlocked.set(true); this.error.set('Sale recovery is unavailable. Review any earlier submission before entering a new sale.'); }
    this.pendingRefund.set(null); this.reviewingRefundRecovery.set(false);
    try {
      const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id); if (!actor) throw new Error('Sign in first');
      this.pendingRefund.set(loadPendingRefund(globalThis.sessionStorage, actor, this.bakeryId)); this.refundRecoveryBlocked.set(false);
    } catch { this.refundRecoveryBlocked.set(true); this.error.set('Refund recovery is unavailable. Review any earlier refund before recording another.'); }
    void this.refresh();
  }
  ngOnDestroy() { this.resetAdjustment(); this.generation++; this.orderRequest++; this.hideFinances(); this.dialog?.nativeElement.close(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancelDialog(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.reviewing.set(null); this.settling.set(null); this.closing.set(null); this.cancellingPickup.set(null); this.expiringPickups.set(false); this.pickupUpdate.set(null); this.resetAdjustment(); this.reviewingRefundRecovery.set(false); } }
  protected rupees(value: string): number { return Number(value) / 100; }
  protected selectedEvent(): SaasEvent | undefined { return this.events().find(row => row._id === this.eventId); }
  protected productName(id: string): string { return this.products().find(row => row._id === id)?.name || 'Product'; }
  protected reviewTotal(input: SaasSaleInput): number { return input.items.reduce((total, line) => total + line.quantity * line.expectedUnitPricePaise, 0) - input.discountPaise; }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not complete the request. Please retry.'); }
  protected hideFinances() { this.financeRequest++; this.finances.set(null); this.financeLoading.set(false); }
  protected async refresh() {
    if (this.busy()) return;
    const generation = this.generation; this.loading.set(true); this.hideFinances();
    try {
      const [products, events] = await Promise.all([firstValueFrom(this.api.products(this.bakeryId, { limit: 100 })), firstValueFrom(this.api.events(this.bakeryId))]);
      if (generation !== this.generation) return;
      this.products.set(products.products); this.productCursor.set(products.nextCursor); this.events.set(events.events); this.eventCursor.set(events.nextCursor);
      await this.loadOrders();
    } catch (error) { if (generation === this.generation) { this.products.set([]); this.events.set([]); this.orders.set([]); this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async more(kind: 'products' | 'events') {
    if (this.busy() || this.loading()) return;
    const cursor = kind === 'products' ? this.productCursor() : this.eventCursor(); if (!cursor) return;
    const generation = this.generation; this.loading.set(true);
    try {
      if (kind === 'products') { const page = await firstValueFrom(this.api.products(this.bakeryId, { limit: 100, cursor })); if (generation !== this.generation) return; this.products.update(rows => [...rows, ...page.products]); this.productCursor.set(page.nextCursor); }
      else { const page = await firstValueFrom(this.api.events(this.bakeryId, cursor)); if (generation !== this.generation) return; this.events.update(rows => [...rows, ...page.events]); this.eventCursor.set(page.nextCursor); }
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async eventChanged() { this.hideFinances(); this.orders.set([]); this.orderCursor.set(null); await this.loadOrders(); }
  protected async loadOrders(more = false) {
    const generation = this.generation, request = ++this.orderRequest, eventId = this.eventId;
    try {
      const page = await firstValueFrom(this.api.orders(this.bakeryId, { ...(eventId ? { eventId } : {}), ...(more && this.orderCursor() ? { cursor: this.orderCursor()! } : {}) }));
      if (generation !== this.generation || request !== this.orderRequest) return;
      this.orders.set(more ? [...this.orders(), ...page.orders] : page.orders); this.orderCursor.set(page.nextCursor);
    } catch (error) { if (generation === this.generation && request === this.orderRequest) { this.orders.set([]); this.orderCursor.set(null); this.failure(error); } }
  }
  protected async toggleFinances() {
    if (this.finances() || this.financeLoading()) { this.hideFinances(); return; }
    if (this.role !== 'owner' || !this.eventId) return;
    const generation = this.generation, request = ++this.financeRequest, eventId = this.eventId; this.financeLoading.set(true);
    try {
      const report = await firstValueFrom(this.api.eventReport(this.bakeryId, eventId));
      if (generation === this.generation && request === this.financeRequest) this.finances.set(report);
    } catch (error) { if (generation === this.generation && request === this.financeRequest) this.failure(error); }
    finally { if (generation === this.generation && request === this.financeRequest) this.financeLoading.set(false); }
  }
  protected addLine() { if (this.form.items.length < 100 && !this.busy() && !this.pending()) this.form.items.push({ productId: '', quantity: 1 }); }
  protected reviewSale() {
    if (this.busy() || this.loading() || this.recoveryBlocked()) return;
    if (this.pending()) { this.reviewing.set(this.pending()); return; }
    if (this.selectedEvent()?.status === 'closed') { this.error.set('Select an open event before recording another sale.'); return; }
    const discountPaise = parseRupeesToPaise(this.form.discount), products = new Map(this.products().map(row => [row._id, row]));
    const seen = new Set<string>();
    if (discountPaise === null || !this.form.items.length || this.form.items.length > 100 || this.form.items.some(line => {
      const duplicate = seen.has(line.productId); seen.add(line.productId);
      return duplicate || !products.get(line.productId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000;
    })) { this.error.set('Check the products, quantities and discount. Combine repeated products into one line.'); return; }
    try {
      const input: SaasSaleInput = { eventId: this.eventId || null,
        items: this.form.items.map(line => ({ ...line, expectedUnitPricePaise: products.get(line.productId)!.pricePaise })),
        discountPaise, paymentStatus: this.form.status, paymentMethod: this.form.status === 'paid' ? this.form.method : null,
        comment: this.form.comment, idempotencyKey: crypto.randomUUID() };
      if (this.reviewTotal(input) < 0 || this.reviewTotal(input) > 1000000000000) { this.error.set('Discount or order amount is outside the supported range.'); return; }
      this.error.set(''); this.reviewing.set(input);
    } catch { this.error.set('This browser could not prepare a safe sale submission.'); }
  }
  protected async confirmSale() {
    const input = this.reviewing(), actorId = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakeryId = this.bakeryId;
    if (!input || !actorId || this.busy() || this.recoveryBlocked()) return;
    const generation = this.generation;
    try { savePendingSale(globalThis.sessionStorage, actorId, bakeryId, input); }
    catch { this.error.set('The recovery record could not be saved. No new request was sent.'); return; }
    this.pending.set(input); this.busy.set(true); this.error.set(''); this.hideFinances(); let saved = false;
    try {
      const result = await firstValueFrom(this.api.createSale(bakeryId, input));
      if (generation !== this.generation) return;
      try { clearPendingSale(globalThis.sessionStorage, actorId, bakeryId, input.idempotencyKey); }
      catch { this.notice.set(`Order ${result.order.orderNumber} is saved.`); this.error.set('Recovery cleanup failed. Retry this same submission before starting another sale.'); return; }
      this.pending.set(null); this.reviewing.set(null); this.notice.set(`Order ${result.order.orderNumber} saved${result.replayed ? ' — existing submission confirmed' : ''}.`);
      this.form = { items: [{ productId: '', quantity: 1 }], discount: '0', status: 'paid', method: 'cash', comment: '' }; saved = true;
    } catch (error) {
      if (generation !== this.generation) return;
      const definite = error instanceof HttpErrorResponse && error.error?.details?.code === 'SALE_REJECTED';
      if (definite) {
        try { clearPendingSale(globalThis.sessionStorage, actorId, bakeryId, input.idempotencyKey); this.pending.set(null); this.reviewing.set(null); }
        catch { this.recoveryBlocked.set(true); }
      }
      this.failure(error);
    } finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.refresh();
  }
  protected pickupLabel(order: SaasOrder) { return order.pickupStatus === 'collected' ? 'Collected' : order.pickupStatus === 'ready' ? 'Ready for pickup' : 'Awaiting preparation'; }
  protected reviewPickup(order: SaasOrder, status: 'ready' | 'collected') {
    if (this.busy() || this.loading() || order.source !== 'storefront' || this.closedPickup(order) || order.pickupStatus === 'collected') return;
    if (status === 'collected' && (order.pickupStatus !== 'ready' || order.paymentStatus !== 'paid' || order.duePaise !== 0)) return;
    if (status === 'ready' && order.pickupStatus === 'ready') return;
    this.error.set(''); this.pickupUpdate.set({ order: structuredClone(order), status });
  }
  protected async confirmPickupUpdate() {
    const review = this.pickupUpdate(); if (!review || this.busy()) return;
    const generation = this.generation; this.busy.set(true); this.error.set(''); let saved = false;
    try {
      const result = await firstValueFrom(this.api.updatePickup(this.bakeryId, review.order._id, review.order.version, review.status));
      if (generation !== this.generation) return;
      this.notice.set(`${review.order.orderNumber}: ${this.pickupLabel({ ...review.order, ...result.order })}.${result.alreadyUpdated ? ' Earlier update confirmed.' : ''}`);
      this.pickupUpdate.set(null); saved = true;
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.loadOrders();
  }
  protected closedPickup(order: SaasOrder) { return ['cancelled', 'expired'].includes(order.reservationStatus || ''); }
  protected canCancelPickup(order: SaasOrder) { return this.role === 'owner' && order.source === 'storefront' && !this.closedPickup(order) && order.pickupStatus !== 'collected' && order.paymentStatus === 'unpaid' && order.receivedPaise === 0 && !order.reservationConfirmedAt; }
  protected stockReturnName(order: SaasOrder, id: string) { return order.items.find(line => line.productId === id)?.name || this.productName(id); }
  protected stockReturnLabel(status: string) { return ({ restored: 'Returned to available stock', not_claimed: 'No tracked stock was reserved', count_changed: 'Recount needed: available stock was changed', untracked: 'Recount needed: stock tracking was disabled', unversioned: 'Recount needed: earlier stock count cannot be verified', product_missing: 'Product no longer found; review stock manually', overflow: 'Recount needed: stock exceeds its supported maximum' } as Record<string, string>)[status] || 'Review stock manually'; }
  protected stockReturnNeedsReview(order: SaasOrder) { return order.reservationReturns?.some(line => !['restored', 'not_claimed'].includes(line.status)); }
  protected reviewPickupCancellation(order: SaasOrder) { if (!this.busy() && !this.loading() && this.canCancelPickup(order)) { this.pickupCancelReason = ''; this.error.set(''); this.cancellingPickup.set(structuredClone(order)); } }
  protected async confirmPickupClosure() {
    const order = this.cancellingPickup(), expiring = this.expiringPickups(), reason = this.pickupCancelReason.trim();
    if (this.role !== 'owner' || this.busy() || (!expiring && (!order || !reason || reason.length > 500))) return;
    const generation = this.generation; this.busy.set(true); this.error.set(''); let saved = false;
    try {
      if (expiring) {
        const result = await firstValueFrom(this.api.expireReservations(this.bakeryId)); if (generation !== this.generation) return;
        this.notice.set(`Released ${result.expiredCount} expired pickup reservations. ${result.reconciliationCount} need a stock recount.${result.hasMore ? ' More are waiting; release another batch.' : ''}`);
      } else {
        await firstValueFrom(this.api.cancelPickup(this.bakeryId, order!._id, order!.version, reason)); if (generation !== this.generation) return;
        this.notice.set('Pickup reservation closed. Check its stock return status below.');
      }
      this.cancellingPickup.set(null); this.expiringPickups.set(false); saved = true;
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.refresh();
  }
  protected async confirmPayment() {
    const order = this.settling(); if (!order || this.busy()) return;
    const generation = this.generation; this.busy.set(true); this.error.set(''); this.hideFinances(); let saved = false;
    try { const changed = await firstValueFrom(this.api.settleSale(this.bakeryId, order._id, order.version, this.receivedMethod)); if (generation !== this.generation) return; this.orders.update(rows => rows.map(row => row._id === changed._id ? changed : row)); this.settling.set(null); this.notice.set('Received payment recorded.'); saved = true; }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.loadOrders();
  }
  private resetAdjustment() {
    this.historyRequest++; this.adjusting.set(null); this.payments.set([]); this.changes.set([]);
    this.paymentHistoryCursor.set(null); this.changeHistoryCursor.set(null); this.historyLoading.set(false);
    this.refundAttempt = null;
  }
  protected openAdjustment(order: SaasOrder, mode: 'discount' | 'refund' | 'history') {
    if (this.role !== 'owner' || this.busy() || this.loading()) return;
    if (mode === 'refund' && (this.pendingRefund() || this.refundRecoveryBlocked())) { this.error.set('Resolve the pending refund record before recording another refund.'); return; }
    this.resetAdjustment(); this.error.set('');
    this.adjustmentForm = { discount: (order.discountPaise / 100).toFixed(2), comment: order.comment, reason: '', method: 'cash' };
    this.adjusting.set({ order: structuredClone(order), mode });
    if (mode === 'history') void this.loadHistory();
  }
  protected async loadHistory(kind?: 'payments' | 'changes') {
    const context = this.adjusting();
    if (!context || context.mode !== 'history' || this.role !== 'owner' || this.historyLoading()) return;
    const generation = this.generation, request = ++this.historyRequest;
    this.historyLoading.set(true);
    try {
      const [payments, changes] = await Promise.all([
        kind === 'changes' ? Promise.resolve(null) : firstValueFrom(this.api.paymentHistory(this.bakeryId, context.order._id, kind === 'payments' ? this.paymentHistoryCursor() || undefined : undefined)),
        kind === 'payments' ? Promise.resolve(null) : firstValueFrom(this.api.correctionHistory(this.bakeryId, context.order._id, kind === 'changes' ? this.changeHistoryCursor() || undefined : undefined)),
      ]);
      if (generation !== this.generation || request !== this.historyRequest) return;
      if (payments) { this.payments.set(kind ? [...this.payments(), ...payments.entries] : payments.entries); this.paymentHistoryCursor.set(payments.nextCursor); }
      if (changes) { this.changes.set(kind ? [...this.changes(), ...changes.entries] : changes.entries); this.changeHistoryCursor.set(changes.nextCursor); }
    } catch (error) { if (generation === this.generation && request === this.historyRequest) this.failure(error); }
    finally { if (generation === this.generation && request === this.historyRequest) this.historyLoading.set(false); }
  }
  protected async confirmAdjustment() {
    const context = this.adjusting();
    if (!context || context.mode === 'history' || this.role !== 'owner' || this.busy()) return;
    const reason = this.adjustmentForm.reason.trim();
    const discountPaise = parseRupeesToPaise(this.adjustmentForm.discount);
    if (!reason || reason.length > 500 || (context.mode === 'discount' && (discountPaise === null || discountPaise > context.order.subtotalPaise))) {
      this.error.set('Enter a reason and a discount within the order subtotal.'); return;
    }
    // Keep the same reviewed refund payload and key after an uncertain response.
    if (context.mode === 'refund' && !this.refundAttempt) {
      try { this.refundAttempt = { expectedVersion: context.order.version, expectedRefundPaise: context.order.refundDuePaise,
        paymentMethod: this.adjustmentForm.method, reason, confirmed: true, idempotencyKey: crypto.randomUUID() }; }
      catch { this.error.set('This browser could not prepare a safe refund record.'); return; }
    }
    if (context.mode === 'refund') {
      await this.submitRefund({ orderId: context.order._id, orderNumber: context.order.orderNumber, request: this.refundAttempt! }); return;
    }
    const generation = this.generation; this.busy.set(true); this.error.set(''); this.hideFinances();
    let saved = false;
    try {
      await firstValueFrom(this.api.correctDiscount(this.bakeryId, context.order._id, {
        expectedVersion: context.order.version, discountPaise: discountPaise!, comment: this.adjustmentForm.comment, reason, confirmed: true,
      }));
      if (generation !== this.generation) return;
      this.notice.set('Discount corrected. Received money was preserved; review any due or refundable balance.');
      this.resetAdjustment(); saved = true;
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.loadOrders();
  }
  protected async retryRefund() {
    const pending = this.pendingRefund(); if (pending) await this.submitRefund(pending);
  }
  private async submitRefund(pending: PendingRefund) {
    const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakery = this.bakeryId;
    if (!actor || this.role !== 'owner' || this.busy() || this.refundRecoveryBlocked()) return;
    try { savePendingRefund(globalThis.sessionStorage, actor, bakery, pending); }
    catch { this.error.set('The refund recovery record could not be saved. No new request was sent.'); return; }
    this.pendingRefund.set(pending); this.busy.set(true); this.error.set(''); this.hideFinances();
    const generation = this.generation; let saved = false;
    try {
      await firstValueFrom(this.api.recordRefund(bakery, pending.orderId, pending.request));
      if (generation !== this.generation) return;
      try { clearPendingRefund(globalThis.sessionStorage, actor, bakery, pending.request.idempotencyKey); }
      catch { this.error.set('The refund record is saved, but recovery cleanup failed. Retry the same record.'); return; }
      this.pendingRefund.set(null); this.reviewingRefundRecovery.set(false); this.resetAdjustment(); saved = true;
      this.notice.set('Manually returned payment recorded.');
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.error?.details?.code === 'REFUND_REJECTED') {
        try { clearPendingRefund(globalThis.sessionStorage, actor, bakery, pending.request.idempotencyKey); this.pendingRefund.set(null); this.reviewingRefundRecovery.set(false); this.resetAdjustment(); }
        catch { this.refundRecoveryBlocked.set(true); }
      }
      this.failure(error);
    } finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.loadOrders();
  }
  protected async createEvent() {
    if (this.role !== 'owner' || this.busy() || this.loading() || this.pending()) return;
    const rentPaise = parseRupeesToPaise(this.eventForm.rent), travelPaise = parseRupeesToPaise(this.eventForm.travel), extraPaise = parseRupeesToPaise(this.eventForm.extra);
    if (rentPaise === null || travelPaise === null || extraPaise === null) { this.error.set('Check event expense amounts.'); return; }
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try { const event = await firstValueFrom(this.api.createEvent(this.bakeryId, { name: this.eventForm.name, key: this.eventForm.key, rentPaise, travelPaise, extraPaise })); if (generation !== this.generation) return; this.events.update(rows => [...rows, event]); this.eventId = event._id; this.eventForm = { name: '', key: '', rent: '0', travel: '0', extra: '0' }; this.hideFinances(); this.orders.set([]); this.orderCursor.set(null); this.notice.set('Event created.'); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async confirmClose() {
    const event = this.closing(); if (!event || this.role !== 'owner' || this.busy() || this.pending()) return;
    const generation = this.generation; this.busy.set(true); this.hideFinances();
    try { const changed = await firstValueFrom(this.api.closeEvent(this.bakeryId, event._id, event.version)); if (generation !== this.generation) return; this.events.update(rows => rows.map(row => row._id === changed._id ? changed : row)); this.closing.set(null); this.notice.set('Event closed. Outstanding dues can still be recorded.'); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
