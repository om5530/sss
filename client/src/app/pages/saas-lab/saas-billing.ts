import { SaasAccountState } from '../../core/services/saas-account-state.service';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { AuthService } from '../../core/services/auth.service';
import { SaasBillingInput, SaasBillingCheckout, SaasBillingPlan, SaasBillingInvoice } from '../../core/models/saas-billing.model';
import { loadBilling, saveBilling, clearBilling, billingLink } from '../../core/utils/saas-billing-recovery';
@Component({ selector: 'app-saas-billing', imports: [FormsModule, CurrencyPipe, DatePipe], templateUrl: './saas-billing.html', styleUrl: './saas-lab.scss' })
export class SaasBilling implements OnChanges, OnDestroy, AfterViewChecked {
 @Input({ required: true }) bakeryId!: string;
 @ViewChild('billingDialog') private dialog?: ElementRef<HTMLDialogElement>;
 private readonly api = inject(SaasService); private readonly workspaceAccount = inject(SaasAccountState, { optional: true });
  private readonly auth = inject(AuthService); private generation = 0; private cancelVersion = 0; private cancelCheckoutId = '';
 protected readonly opened = signal(false); protected readonly configured = signal(false); protected readonly busy = signal(false); protected readonly blocked = signal(false);
 protected readonly checkout = signal<SaasBillingCheckout | null>(null); protected readonly pending = signal<SaasBillingInput | null>(null); protected readonly review = signal<SaasBillingInput | 'cancel' | 'recover' | null>(null);
 protected readonly plans = signal<SaasBillingPlan[]>([]); protected readonly invoices = signal<SaasBillingInvoice[]>([]); protected readonly cursor = signal<string | null>(null);
 protected readonly error = signal(''); protected readonly notice = signal(''); protected providerId = '';
 private readonly onVisibility = () => { if (document.hidden) this.hide(); };
 constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
 ngOnChanges() { this.hide(); this.pending.set(null); this.blocked.set(false); }
 ngOnDestroy() { this.hide(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
 ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
 protected hide() { this.generation++; this.opened.set(false); this.checkout.set(null); this.plans.set([]); this.invoices.set([]); this.cursor.set(null); this.review.set(null); this.configured.set(false); this.busy.set(false); this.error.set(''); this.notice.set(''); this.providerId = ''; this.dialog?.nativeElement.close(); }
 protected close(event?: Event) { event?.preventDefault(); if (!this.busy()) this.review.set(null); }
 protected link(value: string | null) { return billingLink(value); }
 protected invoiceStatus(status: string) { return status.replaceAll('_', ' '); }
 protected async load() {
  if (this.busy()) return; const generation = this.generation; this.opened.set(true); this.busy.set(true); this.error.set('');
  try { const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id); if (!actor) throw new Error('Sign in first'); this.pending.set(loadBilling(globalThis.sessionStorage, actor, this.bakeryId)); this.blocked.set(false); const result = await firstValueFrom(this.api.billing(this.bakeryId)); if (generation !== this.generation) return; this.checkout.set(result.checkout); this.configured.set(result.configured); }
  catch (error) { if (generation === this.generation) { this.checkout.set(null); this.blocked.set(true); this.failure(error); } }
  finally { if (generation === this.generation) this.busy.set(false); }
 }
 protected async loadPlans() {
  if (this.busy() || !this.configured() || this.pending() || this.blocked()) return;
  const generation = this.generation; this.busy.set(true); this.error.set('');
  try { const result = await firstValueFrom(this.api.billingPlans(this.bakeryId)); if (generation === this.generation) this.plans.set(result.plans); }
  catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.busy.set(false); }
 }
 protected canStart() { const row = this.checkout(); return !row || (row.phase === 'ready' && ['cancelled', 'completed', 'expired'].includes(row.providerStatus) && (!row.paidThrough || new Date(row.paidThrough).getTime() <= Date.now())); }
 protected prepare(plan: SaasBillingPlan) { if (!this.busy() && !this.pending() && !this.blocked() && this.canStart()) this.review.set({ planId: plan.planId, expectedAmountPaise: plan.amountPaise, idempotencyKey: crypto.randomUUID() }); }
 protected reviewCancel() { if (!this.busy() && this.checkout()) { this.cancelVersion = this.checkout()!.version; this.cancelCheckoutId = this.checkout()!._id; this.review.set('cancel'); } }
 protected reviewPending() { if (!this.busy() && !this.blocked()) this.review.set(this.pending()); }
 protected isCheckout(value: SaasBillingInput | string): value is SaasBillingInput { return typeof value !== 'string'; }
 protected async confirm() {
  const review = this.review(), actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakery = this.bakeryId; if (!review || !actor || this.busy() || this.blocked()) return;
  if (typeof review !== 'string') { try { saveBilling(globalThis.sessionStorage, actor, bakery, review); this.pending.set(review); } catch { this.error.set('Could not retain checkout recovery. No request was sent.'); return; } }
  if (review === 'cancel' && this.checkout()?._id !== this.cancelCheckoutId) { this.error.set('Checkout changed. Refresh before cancellation.'); return; }
  const generation = this.generation; this.busy.set(true); this.error.set(''); let failure = '';
  try {
   const request = typeof review !== 'string' ? this.api.startBilling(bakery, review) : review === 'cancel' ? this.api.cancelBilling(bakery, this.cancelVersion) : this.api.recoverBilling(bakery, this.checkout()!._id, this.providerId.trim());
   const result = await firstValueFrom(request.pipe(timeout(25000))); if (generation !== this.generation) return;
   this.checkout.set(result.checkout); this.review.set(null);
   if (typeof review !== 'string' && result.checkout.phase === 'ready') { clearBilling(globalThis.sessionStorage, actor, bakery, review.idempotencyKey); this.pending.set(null); }
   this.notice.set(result.checkout.phase === 'creating' ? 'Creation is unresolved. Recover the same attempt from the test dashboard; do not create another subscription.' : 'Test billing updated. Open the authorization link if needed, then refresh provider status.');
  } catch (error) {
   if (generation !== this.generation) return;
   if (typeof review !== 'string' && error instanceof HttpErrorResponse && error.error?.details?.code === 'BILLING_REJECTED') { try { clearBilling(globalThis.sessionStorage, actor, bakery, review.idempotencyKey); this.pending.set(null); this.review.set(null); } catch { this.blocked.set(true); } }
   this.failure(error); failure = this.error();
  } finally { if (generation === this.generation) this.busy.set(false); }
  // Reads reveal the durable creating row after a lost provider response.
  if (generation === this.generation) { await this.load(); if (failure && generation === this.generation) this.error.set(failure); }
 }
 protected async refresh() {
  if (this.busy() || !this.checkout() || this.checkout()?.phase !== 'ready') return; const generation = this.generation; this.busy.set(true); this.error.set('');
  try { const result = await firstValueFrom(this.api.synchronizeBilling(this.bakeryId).pipe(timeout(40000))); if (generation === this.generation) { this.checkout.set(result.checkout); this.notice.set('Provider subscription and invoices reconciled. Refresh the workspace plan to view current access.'); } }
  catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.busy.set(false); }
 }
 protected async loadInvoices(more = false) {
  if (this.busy() || (more && !this.cursor())) return; const generation = this.generation; this.busy.set(true); this.error.set('');
  try { const result = await firstValueFrom(this.api.billingInvoices(this.bakeryId, more ? this.cursor()! : undefined)); if (generation !== this.generation) return; this.invoices.set(more ? [...this.invoices(), ...result.invoices] : result.invoices); this.cursor.set(result.nextCursor); }
  catch (error) { if (generation === this.generation) { this.invoices.set([]); this.cursor.set(null); this.failure(error); } } finally { if (generation === this.generation) this.busy.set(false); }
 }
 private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Billing was not confirmed. Refresh or retry the saved attempt.'); }
}
