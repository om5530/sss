import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasUsage as Usage, SaasUsageResource } from '../../core/models/saas-usage.model';
@Component({ selector: 'app-saas-usage', templateUrl: './saas-usage.html', styleUrl: './saas-lab.scss' })
export class SaasUsage implements OnChanges, OnDestroy {
  @Input({ required: true }) bakeryId!: string;
  private readonly api = inject(SaasService);
  private generation = 0;
  private readonly onVisibility = () => { if (document.hidden) this.hide(); };
  protected readonly report = signal<Usage | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly resources: { key: SaasUsageResource; label: string }[] = [
    { key: 'products', label: 'Products' }, { key: 'materials', label: 'Materials' },
    { key: 'recipes', label: 'Recipe families' }, { key: 'events', label: 'Events' }, { key: 'orders', label: 'Orders' }, { key: 'productionRuns', label: 'Production runs' }, { key: 'materialMovements', label: 'Material movements' }, { key: 'wasteEntries', label: 'Wastage entries' }, { key: 'customers', label: 'Customer accounts' },
  ];
  constructor() { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility); }
  ngOnChanges() { this.hide(); }
  ngOnDestroy() { this.hide(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility); }
  protected hide() { this.generation++; this.report.set(null); this.loading.set(false); this.error.set(''); }
  protected async load() {
    if (this.loading()) return;
    const generation = ++this.generation; this.report.set(null); this.loading.set(true); this.error.set('');
    try {
      const report = await firstValueFrom(this.api.usage(this.bakeryId));
      if (generation === this.generation) this.report.set(report);
    } catch (error) {
      if (generation === this.generation) this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not load usage. Please retry.');
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
}
