import { publicImageUrl } from '../../core/utils/saas-media';
import { SaasBrandHeader } from './saas-brand-header';
import { brandTheme } from '../../core/utils/saas-branding';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { SaasCustomer } from './saas-customer';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasPublicMenu } from '../../core/models/saas-storefront.model';

@Component({ selector: 'app-saas-menu', imports: [CurrencyPipe, SaasCustomer, SaasBrandHeader], templateUrl: './saas-menu.html', styleUrls: ['./saas-lab.scss', './saas-menu.scss'] })
export class SaasMenu implements OnDestroy {
  private readonly api = inject(SaasService);
  private readonly route = inject(ActivatedRoute);
  private readonly subscription: Subscription;
  private generation = 0;
  protected slug = '';
  protected readonly imageUrl = publicImageUrl;
  protected readonly menu = signal<SaasPublicMenu | null>(null);
  protected readonly theme = computed(() => brandTheme(this.menu()?.profile.brandTheme));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  constructor() { this.subscription = this.route.paramMap.subscribe(params => { this.slug = params.get('slug') || ''; void this.load(); }); }
  ngOnDestroy() { this.generation++; this.subscription.unsubscribe(); }
  protected async load(more = false) {
    const previous = this.menu(), generation = ++this.generation;
    if (!more) this.menu.set(null);
    this.loading.set(true); this.error.set('');
    try {
      const menu = await firstValueFrom(this.api.publicMenu(this.slug, more ? previous?.nextCursor || undefined : undefined));
      if (generation !== this.generation) return;
      this.menu.set(more && previous ? { ...menu, products: [...previous.products, ...menu.products] } : menu);
    } catch {
      if (generation === this.generation) { this.menu.set(null); this.error.set('This menu is unavailable. It may be disabled or temporarily disconnected.'); }
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
}
