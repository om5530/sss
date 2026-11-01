import { SaasAccountState } from '../../core/services/saas-account-state.service';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { AuthService } from '../../core/services/auth.service';
import { SaasProduct } from '../../core/models/saas-product.model';
import { PendingProduction, SaasProductionQuote, SaasProductionRun } from '../../core/models/saas-production.model';
import { loadPendingProduction, savePendingProduction, clearPendingProduction } from '../../core/utils/saas-production-recovery';
@Component({ selector: 'app-saas-production', imports: [FormsModule, CurrencyPipe], templateUrl: './saas-production.html', styleUrl: './saas-lab.scss' })
export class SaasProduction implements OnChanges, OnDestroy, AfterViewChecked {
  @Input({ required: true }) bakeryId!: string;
  @ViewChild('productionDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private readonly workspaceAccount = inject(SaasAccountState, { optional: true });
  private readonly auth = inject(AuthService);
  private generation = 0;
  private readonly onVisibility = () => { if (document.hidden) this.showCosts.set(false); };
  protected readonly products = signal<SaasProduct[]>([]);
  protected readonly runs = signal<SaasProductionRun[]>([]);
  protected readonly productCursor = signal<string | null>(null);
  protected readonly runCursor = signal<string | null>(null);
  protected readonly pending = signal<PendingProduction | null>(null);
  protected readonly reviewing = signal<PendingProduction | null>(null);
  protected readonly quote = signal<SaasProductionQuote | null>(null);
  protected readonly blocked = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly showCosts = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected form = { productId: '', batches: 1, note: '' };
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() {
    this.generation++; this.products.set([]); this.runs.set([]); this.productCursor.set(null); this.runCursor.set(null);
    this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false); this.busy.set(false); this.loading.set(false);
    this.form = { productId: '', batches: 1, note: '' }; this.error.set(''); this.notice.set('');
    try {
      const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id); if (!actor) throw new Error('Sign in first');
      this.pending.set(loadPendingProduction(globalThis.sessionStorage, actor, this.bakeryId)); this.blocked.set(false);
    } catch { this.blocked.set(true); this.error.set('Production recovery is unavailable. Review any earlier entry before recording another.'); }
    void this.refresh();
  }
  ngOnDestroy() { this.generation++; this.showCosts.set(false); this.dialog?.nativeElement.close(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false); } }
  protected eligible(product: SaasProduct) { return !!product.recipeRevisionId && product.stockCount !== null && !product.archived; }
  protected money(value: string) { return Number(value) / 100; }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not complete the request. Please retry.'); }
  protected async refresh() {
    if (this.busy() || this.loading()) return;
    const generation = this.generation; this.loading.set(true); this.showCosts.set(false);
    try {
      const [products, runs] = await Promise.all([firstValueFrom(this.api.products(this.bakeryId, { limit: 100 })), firstValueFrom(this.api.productionRuns(this.bakeryId))]);
      if (generation !== this.generation) return;
      this.products.set(products.products); this.productCursor.set(products.nextCursor); this.runs.set(runs.runs); this.runCursor.set(runs.nextCursor);
    } catch (error) { if (generation === this.generation) { this.products.set([]); this.runs.set([]); this.productCursor.set(null); this.runCursor.set(null); this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async more(kind: 'products' | 'runs') {
    const cursor = kind === 'products' ? this.productCursor() : this.runCursor();
    if (!cursor || this.busy() || this.loading()) return;
    const generation = this.generation; this.loading.set(true);
    try {
      if (kind === 'products') {
        const page = await firstValueFrom(this.api.products(this.bakeryId, { limit: 100, cursor })); if (generation !== this.generation) return;
        this.products.update(rows => [...rows, ...page.products]); this.productCursor.set(page.nextCursor);
      } else {
        const page = await firstValueFrom(this.api.productionRuns(this.bakeryId, cursor)); if (generation !== this.generation) return;
        this.runs.update(rows => [...rows, ...page.runs]); this.runCursor.set(page.nextCursor);
      }
    } catch (error) { if (generation === this.generation) { this.showCosts.set(false); if (error instanceof HttpErrorResponse && [403, 404].includes(error.status)) { this.products.set([]); this.runs.set([]); this.productCursor.set(null); this.runCursor.set(null); } this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected reviewPending() { if (!this.busy() && !this.blocked()) { this.quote.set(null); this.reviewing.set(this.pending()); } }
  protected async prepare() {
    if (this.busy() || this.loading() || this.pending() || this.blocked()) return;
    const product = this.products().find(row => row._id === this.form.productId);
    if (!product || !this.eligible(product) || !Number.isSafeInteger(this.form.batches) || this.form.batches < 1 || this.form.batches > 1000) { this.error.set('Choose a mapped product with tracked stock and 1–1000 whole batches.'); return; }
    const input = { productId: product._id, revisionId: product.recipeRevisionId!, expectedProductVersion: product.version, batches: this.form.batches, note: this.form.note };
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      const quote = await firstValueFrom(this.api.productionQuote(this.bakeryId, input)); if (generation !== this.generation) return;
      this.quote.set(quote); this.reviewing.set({ productName: quote.productName, producedPieces: quote.producedPieces, input: { ...input, ...(quote.inventoryFingerprint ? { inventoryFingerprint: quote.inventoryFingerprint } : {}), confirmed: true, idempotencyKey: crypto.randomUUID() } });
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async confirm() {
    const pending = this.reviewing(), actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakery = this.bakeryId;
    if (!pending || !actor || this.busy() || this.blocked()) return;
    try { savePendingProduction(globalThis.sessionStorage, actor, bakery, pending); }
    catch { this.error.set('The recovery record could not be saved. No request was sent.'); return; }
    const generation = this.generation; this.pending.set(pending); this.busy.set(true); this.error.set(''); this.showCosts.set(false); let saved = false;
    try {
      const result = await firstValueFrom(this.api.recordProduction(bakery, pending.input)); if (generation !== this.generation) return;
      try { clearPendingProduction(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); }
      catch { this.error.set('Production is saved, but recovery cleanup failed. Retry the same entry.'); return; }
      this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.form = { productId: '', batches: 1, note: '' }; saved = true;
      this.notice.set(`${result.run.producedPieces} pieces recorded${result.replayed ? ' — existing entry confirmed' : ' and added to stock'}.`);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.error?.details?.code === 'PRODUCTION_REJECTED') {
        try { clearPendingProduction(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); }
        catch { this.blocked.set(true); }
      }
      this.failure(error);
    } finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.refresh();
  }
}
