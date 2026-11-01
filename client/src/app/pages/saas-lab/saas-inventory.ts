import { SaasAccountState } from '../../core/services/saas-account-state.service';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { SaasWaste } from './saas-waste';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { SaasService } from '../../core/services/saas.service';
import { SaasMaterial, SaasUom } from '../../core/models/saas-recipe.model';
import { PendingInventory, SaasInventoryInput, SaasInventoryQuote, SaasMaterialStock, SaasMaterialMovement } from '../../core/models/saas-inventory.model';
import { loadPendingInventory, savePendingInventory, clearPendingInventory } from '../../core/utils/saas-inventory-recovery';
@Component({ selector: 'app-saas-inventory', imports: [FormsModule, CurrencyPipe, SaasWaste], templateUrl: './saas-inventory.html', styleUrl: './saas-lab.scss' })
export class SaasInventory implements OnChanges, OnDestroy, AfterViewChecked {
  @Input({ required: true }) bakeryId!: string;
  @ViewChild('inventoryDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private readonly workspaceAccount = inject(SaasAccountState, { optional: true });
  private readonly auth = inject(AuthService);
  private generation = 0;
  private historyRequest = 0;
  private readonly onVisibility = () => { if (document.hidden) this.showCosts.set(false); };
  protected readonly materials = signal<SaasMaterial[]>([]);
  protected readonly stocks = signal<SaasMaterialStock[]>([]);
  protected readonly pending = signal<PendingInventory | null>(null);
  protected readonly reviewing = signal<PendingInventory | null>(null);
  protected readonly quote = signal<SaasInventoryQuote | null>(null);
  protected readonly blocked = signal(false);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly showCosts = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly history = signal<SaasMaterialMovement[]>([]);
  protected readonly historyId = signal('');
  protected readonly historyName = signal('');
  protected readonly historyCursor = signal<string | null>(null);
  protected readonly historyLoading = signal(false);
  protected readonly units: SaasUom[] = ['mg', 'g', 'kg', 'ml', 'L', 'piece', 'dozen', 'packet', 'box'];
  protected form = { materialId: '', kind: 'opening' as SaasInventoryInput['kind'], quantity: '0', uom: 'g' as SaasUom, reason: '' };
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() {
    this.generation++; this.clearHistory(); this.materials.set([]); this.stocks.set([]); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false);
    this.busy.set(false); this.loading.set(false); this.error.set(''); this.notice.set(''); this.form = { materialId: '', kind: 'opening', quantity: '0', uom: 'g', reason: '' };
    try { const actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id); if (!actor) throw new Error('Sign in first'); this.pending.set(loadPendingInventory(globalThis.sessionStorage, actor, this.bakeryId)); this.blocked.set(false); }
    catch { this.blocked.set(true); this.error.set('Inventory recovery is unavailable. Review any earlier entry before recording another.'); }
    void this.refresh();
  }
  ngOnDestroy() { this.generation++; this.clearHistory(); this.showCosts.set(false); this.dialog?.nativeElement.close(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.reviewing.set(null); this.quote.set(null); this.showCosts.set(false); } }
  protected money(value: string) { return Number(value) / 100; }
  protected stockFor(id: string) { return this.stocks().find(row => row.materialId === id); }
  protected physical(material: SaasMaterial) { return ['ingredient', 'packaging'].includes(material.type) && this.units.includes(material.packUom); }
  protected materialChanged() {
    const material = this.materials().find(row => row._id === this.form.materialId), stock = this.stockFor(this.form.materialId);
    this.form.kind = stock ? material?.active ? 'receipt' : 'waste' : 'opening'; this.form.uom = stock?.unit || material?.packUom || 'g'; this.form.quantity = stock ? '1' : '0';
  }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not complete the request. Please retry.'); }
  private async allMaterials(bakery: string) {
    const rows: SaasMaterial[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page++) { const result = await firstValueFrom(this.api.materials(bakery, cursor, true)); rows.push(...result.items); if (!result.nextCursor) return rows; cursor = result.nextCursor; }
    throw new Error('Material list could not be loaded completely');
  }
  private async allStocks(bakery: string) {
    const rows: SaasMaterialStock[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page++) { const result = await firstValueFrom(this.api.inventory(bakery, cursor)); rows.push(...result.stocks); if (!result.nextCursor) return rows; cursor = result.nextCursor; }
    throw new Error('Inventory list could not be loaded completely');
  }
  protected async refresh() {
    if (this.busy() || this.loading()) return;
    const generation = this.generation, bakery = this.bakeryId; this.loading.set(true); this.showCosts.set(false); this.clearHistory();
    try { const [materials, stocks] = await Promise.all([this.allMaterials(bakery), this.allStocks(bakery)]); if (generation !== this.generation) return; this.materials.set(materials); this.stocks.set(stocks); }
    catch (error) { if (generation === this.generation) { this.materials.set([]); this.stocks.set([]); this.failure(error); } }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected clearHistory() { this.historyRequest++; this.history.set([]); this.historyId.set(''); this.historyName.set(''); this.historyCursor.set(null); this.historyLoading.set(false); }
  protected async loadHistory(id: string, more = false) {
    if (this.busy() || this.historyLoading()) return;
    if (!more) { this.clearHistory(); this.historyId.set(id); this.historyName.set(this.materials().find(row => row._id === id)?.name || 'Material'); }
    if (more && !this.historyCursor()) return;
    const generation = this.generation, request = ++this.historyRequest; this.historyLoading.set(true);
    try { const result = await firstValueFrom(this.api.materialHistory(this.bakeryId, id, more ? this.historyCursor()! : undefined)); if (generation !== this.generation || request !== this.historyRequest) return; this.history.set(more ? [...this.history(), ...result.entries] : result.entries); this.historyCursor.set(result.nextCursor); }
    catch (error) { if (generation === this.generation && request === this.historyRequest) { this.history.set([]); this.historyCursor.set(null); this.showCosts.set(false); this.failure(error); } }
    finally { if (generation === this.generation && request === this.historyRequest) this.historyLoading.set(false); }
  }
  protected reviewPending() { if (!this.busy() && !this.blocked()) { this.quote.set(null); this.reviewing.set(this.pending()); } }
  protected async prepare() {
    if (this.busy() || this.loading() || this.pending() || this.blocked()) return;
    const material = this.materials().find(row => row._id === this.form.materialId), stock = this.stockFor(this.form.materialId);
    if (!material || !this.physical(material)) { this.error.set('Choose a physical ingredient or packaging material.'); return; }
    const input: SaasInventoryInput = { materialId: material._id, kind: this.form.kind, quantity: this.form.quantity.trim(), uom: this.form.uom,
      expectedMaterialVersion: material.version, expectedStockVersion: stock?.version || 0, reason: this.form.reason.trim() };
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try { const quote = await firstValueFrom(this.api.inventoryQuote(this.bakeryId, input)); if (generation !== this.generation) return;
      this.quote.set(quote); this.reviewing.set({ materialName: quote.materialName, input: { ...input, confirmed: true, idempotencyKey: crypto.randomUUID() } }); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  protected async confirm() {
    const pending = this.reviewing(), actor = (this.workspaceAccount?.account()?.id || this.auth.user()?.id), bakery = this.bakeryId;
    if (!pending || !actor || this.busy() || this.blocked()) return;
    try { savePendingInventory(globalThis.sessionStorage, actor, bakery, pending); }
    catch { this.error.set('The recovery record could not be saved. No request was sent.'); return; }
    const generation = this.generation; this.pending.set(pending); this.busy.set(true); this.error.set(''); this.showCosts.set(false); let saved = false;
    try { const result = await firstValueFrom(this.api.recordInventory(bakery, pending.input)); if (generation !== this.generation) return;
      try { clearPendingInventory(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); }
      catch { this.error.set('The entry is saved, but recovery cleanup failed. Retry the same record.'); return; }
      this.pending.set(null); this.reviewing.set(null); this.quote.set(null); saved = true; this.notice.set(`Material ${result.entry.kind} recorded${result.replayed ? ' — existing entry confirmed' : ''}.`);
    } catch (error) { if (generation !== this.generation) return;
      if (error instanceof HttpErrorResponse && error.error?.details?.code === 'INVENTORY_REJECTED') { try { clearPendingInventory(globalThis.sessionStorage, actor, bakery, pending.input.idempotencyKey); this.pending.set(null); this.reviewing.set(null); this.quote.set(null); } catch { this.blocked.set(true); } }
      this.failure(error);
    } finally { if (generation === this.generation) this.busy.set(false); }
    if (saved && generation === this.generation) await this.refresh();
  }
}
