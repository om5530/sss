import { SaasAccountState } from '../../core/services/saas-account-state.service';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { SaasService } from '../../core/services/saas.service';
import { SaasProduct } from '../../core/models/saas-product.model';
import { SaasEvent } from '../../core/models/saas-sales.model';
import { PendingWaste, SaasWasteInput, SaasWasteQuote, SaasWasteEntry } from '../../core/models/saas-waste.model';
import { loadPendingWaste, savePendingWaste, clearPendingWaste } from '../../core/utils/saas-waste-recovery';
@Component({ selector: 'app-saas-waste', imports: [FormsModule, CurrencyPipe], templateUrl: './saas-waste.html', styleUrl: './saas-lab.scss' })
export class SaasWaste implements OnChanges, OnDestroy, AfterViewChecked {
  @Input({ required: true }) bakeryId!: string;
  @ViewChild('wasteDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private readonly workspaceAccount = inject(SaasAccountState, { optional: true });
  private readonly auth = inject(AuthService);
  private generation = 0;
  private readonly onVisibility = () => { if (document.hidden) this.showCosts.set(false); };
  protected readonly products = signal<SaasProduct[]>([]);
  protected readonly events = signal<SaasEvent[]>([]);
  protected readonly entries = signal<SaasWasteEntry[]>([]);
  protected readonly productCursor = signal<string | null>(null);
  protected readonly eventCursor = signal<string | null>(null);
  protected readonly entryCursor = signal<string | null>(null);
  protected readonly pending = signal<PendingWaste | null>(null);
  protected readonly reviewing = signal<PendingWaste | null>(null);
  protected readonly quote = signal<SaasWasteQuote | null>(null);
  protected readonly blocked = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly showCosts = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected form = { productId: '', eventId: '', quantity: 1, reason: '' };
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() {
    this.generation++; this.products.set([]); this.events.set([]); this.entries.set([]); this.productCursor.set(null); this.eventCursor.set(null); this.entryCursor.set(null);
    this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false); this.busy.set(false); this.loading.set(false); this.error.set(''); this.notice.set(''); this.form = { productId: '', eventId: '', quantity: 1, reason: '' };
    try { const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id); if (!actor) throw new Error('Sign in first'); this.pending.set(loadPendingWaste(globalThis.sessionStorage, actor, this.bakeryId)); this.blocked.set(false); }
    catch { this.blocked.set(true); this.error.set('Wastage recovery is unavailable. Review any earlier entry before recording another.'); }
    void this.refresh();
  }
  ngOnDestroy() { this.generation++; this.showCosts.set(false); this.dialog?.nativeElement.close(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false); } }
  protected eligible(product: SaasProduct) { return product.stockCount !== null && product.stockCount > 0; }
  protected money(value: string) { return Number(value) / 100; }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not complete the request. Please retry.'); }
  protected async refresh() {
    if (this.busy() || this.loading()) return;
    const generation = this.generation; this.loading.set(true); this.showCosts.set(false);
    try { const [products, events, entries] = await Promise.all([firstValueFrom(this.api.products(this.bakeryId, { limit: 100, archived: 'all' })), firstValueFrom(this.api.events(this.bakeryId)), firstValueFrom(this.api.wasteEntries(this.bakeryId))]);
      if (generation !== this.generation) return; this.products.set(products.products); this.productCursor.set(products.nextCursor); this.events.set(events.events); this.eventCursor.set(events.nextCursor); this.entries.set(entries.entries); this.entryCursor.set(entries.nextCursor); }
    catch (error) { if (generation === this.generation) { this.products.set([]); this.events.set([]); this.entries.set([]); this.productCursor.set(null); this.eventCursor.set(null); this.entryCursor.set(null); this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async more(kind: 'products' | 'events' | 'entries') {
    const cursor = kind === 'products' ? this.productCursor() : kind === 'events' ? this.eventCursor() : this.entryCursor(); if (!cursor || this.busy() || this.loading()) return;
    const generation = this.generation; this.loading.set(true);
    try {
      if (kind === 'products') { const page = await firstValueFrom(this.api.products(this.bakeryId, { limit: 100, archived: 'all', cursor })); if (generation !== this.generation) return; this.products.update(rows => [...rows, ...page.products]); this.productCursor.set(page.nextCursor); }
      else if (kind === 'events') { const page = await firstValueFrom(this.api.events(this.bakeryId, cursor)); if (generation !== this.generation) return; this.events.update(rows => [...rows, ...page.events]); this.eventCursor.set(page.nextCursor); }
      else { const page = await firstValueFrom(this.api.wasteEntries(this.bakeryId, cursor)); if (generation !== this.generation) return; this.entries.update(rows => [...rows, ...page.entries]); this.entryCursor.set(page.nextCursor); }
    } catch (error) { if (generation === this.generation) { this.showCosts.set(false); this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected reviewPending() { if (!this.busy() && !this.blocked()) { this.quote.set(null); this.reviewing.set(this.pending()); } }
  protected async prepare() {
    if (this.busy() || this.loading() || this.pending() || this.blocked()) return;
    const product = this.products().find(row => row._id === this.form.productId);
    if (!product || !this.eligible(product) || !Number.isSafeInteger(this.form.quantity) || this.form.quantity < 1 || this.form.quantity > product.stockCount!) { this.error.set('Choose tracked stock and a whole quantity within the remaining count.'); return; }
    const input: SaasWasteInput = { productId: product._id, eventId: this.form.eventId || null, expectedProductVersion: product.version, quantity: this.form.quantity, reason: this.form.reason.trim() };
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try { const quote = await firstValueFrom(this.api.wasteQuote(this.bakeryId, input)); if (generation !== this.generation) return;
      this.quote.set(quote); this.reviewing.set({ productName: quote.productName, eventName: quote.eventName, input: { ...input, confirmed: true, idempotencyKey: crypto.randomUUID() } }); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async confirm() {
    const pending = this.reviewing(), actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakery = this.bakeryId;
    if (!pending || !actor || this.busy() || this.blocked()) return;
    try { savePendingWaste(globalThis.sessionStorage, actor, bakery, pending); }
    catch { this.error.set('The recovery record could not be saved. No request was sent.'); return; }
    const generation = this.generation; this.pending.set(pending); this.busy.set(true); this.error.set(''); this.showCosts.set(false); let saved = false;
    try { const result = await firstValueFrom(this.api.recordWaste(bakery, pending.input)); if (generation !== this.generation) return;
      try { clearPendingWaste(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); }
      catch { this.error.set('Wastage is saved, but recovery cleanup failed. Retry the same entry.'); return; }
      this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.form = { productId: '', eventId: '', quantity: 1, reason: '' }; saved = true; this.notice.set(`Wastage recorded${result.replayed ? ' — existing entry confirmed' : ' and stock reduced'}.`);
    } catch (error) { if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.error?.details?.code === 'WASTE_REJECTED') { try { clearPendingWaste(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); } catch { this.blocked.set(true); } } this.failure(error);
    } finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.refresh();
  }
}
