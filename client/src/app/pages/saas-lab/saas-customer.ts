import { SaasCustomerSecurity } from './saas-customer-security';
import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, OnChanges, OnDestroy, ViewChild, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasCustomerService } from '../../core/services/saas-customer.service';
import { SaasCustomer as Customer, SaasCustomerOrder, SaasCustomerQuote, SaasCustomerSubmit } from '../../core/models/saas-customer.model';
import { SaasPublicMenu } from '../../core/models/saas-storefront.model';
import { loadCustomerOrder, saveCustomerOrder, clearCustomerOrder } from '../../core/utils/saas-customer-recovery';
@Component({ selector: 'app-saas-customer', imports: [FormsModule, CurrencyPipe, DatePipe, SaasCustomerSecurity], templateUrl: './saas-customer.html', styleUrl: './saas-lab.scss' })
export class SaasCustomer implements OnChanges, OnDestroy, AfterViewChecked {
  @Output() availabilityChanged = new EventEmitter<void>();
  @Input({ required: true }) slug!: string;
  @Input({ required: true }) bakeryName!: string;
  @Input({ required: true }) orderingEnabled!: boolean;
  @Input({ required: true }) products!: SaasPublicMenu['products'];
  @ViewChild('customerDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasCustomerService);
  private generation = 0;
  private activeSlug = '';
  private orderRequest = 0;
  protected readonly customer = signal<Customer | null>(null);
  protected readonly orders = signal<SaasCustomerOrder[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly pending = signal<SaasCustomerSubmit | null>(null);
  protected readonly reviewing = signal<SaasCustomerSubmit | null>(null);
  protected readonly quote = signal<SaasCustomerQuote | null>(null);
  protected readonly cancelling = signal<SaasCustomerOrder | null>(null);
  protected readonly moreExpired = signal(false);
  protected cancelReason = '';
  protected readonly blocked = signal(false);
  protected readonly working = signal(false);
  protected readonly accountBusy = signal(false);
  protected readonly busy = computed(() => this.working() || this.accountBusy());
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected mode: 'login' | 'register' = 'login';
  protected credentials = { email: '', password: '', displayName: '' };
  protected form = { items: [{ productId: '', quantity: 1 }], comment: '' };
  ngOnChanges() {
    // Menu paging/refresh may replace product inputs; keep the account, cart
    // and frozen retry when the bakery slug itself has not changed.
    if (this.activeSlug === this.slug) return;
    this.activeSlug = this.slug; this.accountBusy.set(false); this.generation++; this.orderRequest++; this.clearAccount(); this.working.set(false); this.loading.set(false);
    this.error.set(''); this.notice.set(''); this.credentials = { email: '', password: '', displayName: '' }; this.form = { items: [{ productId: '', quantity: 1 }], comment: '' }; this.mode = 'login';
    void this.restore();
  }
  ngOnDestroy() { this.generation++; this.orderRequest++; this.credentials.password = ''; this.clearAccount(); this.dialog?.nativeElement.close(); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.reviewing.set(null); this.quote.set(null); this.cancelling.set(null); } }
  private clearAccount() { this.accountBusy.set(false); this.cancelling.set(null); this.moreExpired.set(false); this.customer.set(null); this.orders.set([]); this.cursor.set(null); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.blocked.set(false); this.form = { items: [{ productId: '', quantity: 1 }], comment: '' }; this.credentials.password = ''; }
  private failure(error: unknown) {
    this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not complete the request. Please retry.');
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.error?.details?.code === 'CUSTOMER_SESSION_CHANGED')) { this.orderRequest++; this.clearAccount(); this.notice.set('Sign in again to confirm any pending pickup order.'); }
  }
  private acceptAccount(customer: Customer) {
    if (this.customer()?.id && this.customer()?.id !== customer.id) { this.orderRequest++; this.clearAccount(); }
    this.customer.set(customer);
    try { this.pending.set(loadCustomerOrder(globalThis.sessionStorage, this.slug, customer.id)); this.blocked.set(false); }
    catch { this.blocked.set(true); this.error.set('Order recovery needs review before placing another pickup order.'); }
  }
  protected async securityChanged(message: string) {
    const generation = this.generation; this.orderRequest++; this.clearAccount(); this.mode = 'login';
    await this.restore(); if (generation === this.generation) this.notice.set(message);
  }
  protected async restore() {
    const generation = this.generation; this.loading.set(true);
    try { const customer = await firstValueFrom(this.api.me(this.slug)); if (generation !== this.generation) return; this.acceptAccount(customer); await this.loadOrders(); }
    catch (error) { if (generation === this.generation && !(error instanceof HttpErrorResponse && [401, 404].includes(error.status))) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async signIn() {
    if (this.busy() || this.loading() || (this.mode === 'register' && !this.orderingEnabled)) return;
    const input = { ...this.credentials }, mode = this.mode, generation = this.generation;
    this.credentials.password = ''; this.working.set(true); this.error.set(''); this.notice.set('');
    try {
      const customer = await firstValueFrom(mode === 'register' ? this.api.register(this.slug, input) : this.api.login(this.slug, { email: input.email, password: input.password }));
      if (generation !== this.generation) return; this.acceptAccount(customer); this.credentials = { email: '', password: '', displayName: '' }; await this.loadOrders();
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { input.password = ''; if (generation === this.generation) this.working.set(false); }
  }
  protected async signOut() {
    if (!this.customer() || this.busy()) return;
    const generation = this.generation; this.working.set(true); this.error.set('');
    try { await firstValueFrom(this.api.logout(this.slug, this.customer()!.id)); if (generation !== this.generation) return; this.orderRequest++; this.clearAccount(); this.form = { items: [{ productId: '', quantity: 1 }], comment: '' }; this.notice.set('Signed out of this bakery. Pending order recovery is retained for your next sign-in.'); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.working.set(false); }
  }
  protected async loadOrders(more = false) {
    if (!this.customer() || (more && !this.cursor())) return;
    const generation = this.generation, request = ++this.orderRequest;
    try { if (!more) await this.releaseExpired(); if (generation !== this.generation || request !== this.orderRequest) return; const result = await firstValueFrom(this.api.orders(this.slug, this.customer()!.id, more ? this.cursor()! : undefined)); if (generation !== this.generation || request !== this.orderRequest) return; this.orders.set(more ? [...this.orders(), ...result.orders] : result.orders); this.cursor.set(result.nextCursor); }
    catch (error) { if (generation === this.generation && request === this.orderRequest) { this.orders.set([]); this.cursor.set(null); this.failure(error); } }
  }
  private async releaseExpired() {
    const customer = this.customer(), generation = this.generation;
    if (!customer) return;
    const result = await firstValueFrom(this.api.refreshReservations(this.slug, customer.id));
    if (generation !== this.generation || customer.id !== this.customer()?.id) return;
    this.moreExpired.set(result.hasMore);
    if (result.availabilityChanged) this.availabilityChanged.emit();
  }
  protected canCancel(order: SaasCustomerOrder) { return !['cancelled', 'expired'].includes(order.reservationStatus || '') && order.pickupStatus !== 'collected' && order.paymentStatus === 'unpaid' && order.receivedPaise === 0 && !order.reservationConfirmedAt; }
  protected reviewCancel(order: SaasCustomerOrder) { if (!this.busy() && this.canCancel(order)) { this.error.set(''); this.cancelReason = ''; this.cancelling.set(structuredClone(order)); } }
  protected async confirmCancel() {
    const order = this.cancelling(), customer = this.customer(), reason = this.cancelReason.trim();
    if (!order || !customer || this.busy() || !reason || reason.length > 500) return;
    const generation = this.generation; this.working.set(true); this.error.set(''); let saved = false;
    try {
      const result = await firstValueFrom(this.api.cancelOrder(this.slug, customer.id, order._id, order.version, reason));
      if (generation !== this.generation) return;
      this.cancelling.set(null); this.notice.set(`${order.orderNumber} is ${result.order.reservationStatus}. No payment was taken.`); this.availabilityChanged.emit(); saved = true;
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.working.set(false); }
    if (saved) await this.loadOrders();
  }
  protected addLine() { if (!this.busy() && !this.pending() && this.form.items.length < 100) this.form.items.push({ productId: '', quantity: 1 }); }
  protected productName(id: string) { return this.products.find(row => row.id === id)?.name || 'Previously selected item'; }
  protected total(input: SaasCustomerSubmit) { return input.items.reduce((total, line) => total + line.quantity * line.expectedUnitPricePaise, 0); }
  protected reviewPending() { if (!this.busy() && !this.blocked()) { this.quote.set(null); this.reviewing.set(this.pending()); } }
  protected async prepare() {
    if (!this.customer() || this.busy() || this.loading() || this.pending() || this.blocked() || !this.orderingEnabled) return;
    const menu = new Map(this.products.map(row => [row.id, row])), seen = new Set<string>();
    if (!this.form.items.length || this.form.items.length > 100 || this.form.items.some(line => {
      const repeated = seen.has(line.productId); seen.add(line.productId);
      return repeated || !menu.get(line.productId)?.available || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000;
    })) { this.error.set('Choose available items and whole quantities. Combine repeated items into one line.'); return; }
    const input = { items: this.form.items.map(line => ({ ...line, expectedUnitPricePaise: menu.get(line.productId)!.pricePaise })), comment: this.form.comment };
    const generation = this.generation; this.working.set(true); this.error.set('');
    try { await this.releaseExpired(); if (generation !== this.generation || !this.customer()) return; const quote = await firstValueFrom(this.api.quote(this.slug, this.customer()!.id, input)); if (generation !== this.generation) return; this.quote.set(quote); this.reviewing.set({ ...input, expectedReservationMinutes: quote.reservationMinutes, confirmed: true, idempotencyKey: crypto.randomUUID() }); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.working.set(false); }
  }
  protected async confirm() {
    const input = this.reviewing(), customer = this.customer(), slug = this.slug;
    if (!input || !customer || this.busy() || this.blocked()) return;
    try { saveCustomerOrder(globalThis.sessionStorage, slug, customer.id, input); }
    catch { this.error.set('Order recovery could not be saved. No order request was sent.'); return; }
    const generation = this.generation; this.pending.set(input); this.working.set(true); this.error.set(''); let saved = false;
    try {
      const result = await firstValueFrom(this.api.order(slug, customer.id, input)); if (generation !== this.generation) return;
      try { clearCustomerOrder(globalThis.sessionStorage, slug, customer.id, input.idempotencyKey); }
      catch { this.error.set(`Order ${result.order.orderNumber} is saved, but recovery cleanup failed. Retry the same order.`); return; }
      this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.form = { items: [{ productId: '', quantity: 1 }], comment: '' }; saved = true;
      this.notice.set(`${result.order.orderNumber} ${result.replayed ? 'already saved — confirmed' : 'placed'}. ${['cancelled', 'expired'].includes(result.order.reservationStatus || '') ? 'This reservation is closed; no payment is due.' : result.order.paymentStatus === 'paid' ? 'Payment is recorded.' : 'Payment is due at pickup.'}`);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.error?.details?.code === 'SALE_REJECTED') {
        try { clearCustomerOrder(globalThis.sessionStorage, slug, customer.id, input.idempotencyKey); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); }
        catch { this.blocked.set(true); }
      }
      this.failure(error);
    } finally { if (generation === this.generation) this.working.set(false); }
    if (saved && generation === this.generation) { this.availabilityChanged.emit(); await this.loadOrders(); }
  }
}
