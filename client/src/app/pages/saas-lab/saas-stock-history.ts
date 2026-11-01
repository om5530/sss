import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasStockMovement } from '../../core/models/saas-stock.model';
@Component({ selector: 'app-saas-stock-history', templateUrl: './saas-stock-history.html', styleUrl: './saas-lab.scss' })
export class SaasStockHistory implements OnChanges, OnDestroy {
  @Input({ required: true }) bakeryId!: string;
  @Input({ required: true }) productId!: string;
  @Input({ required: true }) name!: string;
  private readonly api = inject(SaasService);
  private generation = 0;
  protected readonly entries = signal<SaasStockMovement[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  ngOnChanges() { this.generation++; this.entries.set([]); this.cursor.set(null); this.loading.set(false); void this.load(); }
  ngOnDestroy() { this.generation++; this.entries.set([]); }
  protected async load(more = false) {
    if (this.loading() || (more && !this.cursor())) return;
    const generation = this.generation; this.loading.set(true); this.error.set('');
    try {
      const result = await firstValueFrom(this.api.stockHistory(this.bakeryId, this.productId, more ? this.cursor()! : undefined));
      if (generation !== this.generation) return;
      this.entries.set(more ? [...this.entries(), ...result.entries] : result.entries); this.cursor.set(result.nextCursor);
    } catch (error) {
      if (generation === this.generation) { this.entries.set([]); this.cursor.set(null); this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not load stock history. Retry.'); }
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
}
