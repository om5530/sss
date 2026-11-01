import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasSubscriptionReport, SaasSubscriptionChange } from '../../core/models/saas-subscription.model';
@Component({ selector: 'app-saas-subscription', imports: [DatePipe], templateUrl: './saas-subscription.html', styleUrl: './saas-lab.scss' })
export class SaasSubscription implements OnChanges, OnDestroy {
  @Input({ required: true }) bakeryId!: string;
  private readonly api = inject(SaasService);
  private generation = 0;
  private historyRequest = 0;
  protected readonly report = signal<SaasSubscriptionReport | null>(null);
  protected readonly changes = signal<SaasSubscriptionChange[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly historyLoading = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly error = signal('');
  private readonly onVisibility = () => { if (document.hidden) this.hide(); };
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() { this.hide(); }
  ngOnDestroy() { this.hide(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  protected hide() { this.generation++; this.historyRequest++; this.report.set(null); this.changes.set([]); this.cursor.set(null); this.historyOpen.set(false); this.loading.set(false); this.historyLoading.set(false); this.error.set(''); }
  protected async load() {
    if (this.loading()) return;
    this.hide(); const generation = this.generation; this.loading.set(true);
    try { const report = await firstValueFrom(this.api.subscription(this.bakeryId)); if (generation === this.generation) this.report.set(report); }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async history(more = false) {
    if (!this.report() || this.historyLoading() || (more && !this.cursor())) return;
    const generation = this.generation, request = ++this.historyRequest; this.historyLoading.set(true); this.historyOpen.set(true); this.error.set('');
    if (!more) { this.changes.set([]); this.cursor.set(null); }
    try { const page = await firstValueFrom(this.api.subscriptionHistory(this.bakeryId, more ? this.cursor()! : undefined)); if (generation !== this.generation || request !== this.historyRequest) return; this.changes.set(more ? [...this.changes(), ...page.entries] : page.entries); this.cursor.set(page.nextCursor); }
    catch (error) { if (generation === this.generation && request === this.historyRequest) { this.changes.set([]); this.cursor.set(null); this.report.set(null); this.failure(error); } }
    finally { if (generation === this.generation && request === this.historyRequest) this.historyLoading.set(false); }
  }
  protected label(value: string) { return ({ development: 'Development access', trial: 'Trial access', active: 'Active access', grace: 'Payment grace period', restricted: 'Restricted access', trialing: 'Trial', past_due: 'Payment overdue', cancelled: 'Cancelled' } as Record<string, string>)[value] || value; }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not load plan information. Please retry.'); }
}
