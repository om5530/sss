import { environment } from '../../../environments/environment';
import { validLocalMenuLink, validStagingMenuLink } from '../../core/utils/saas-menu-link';
import { SaasMedia } from './saas-media';
import { SaasBrandHeader } from './saas-brand-header';
import { SaasBilling } from './saas-billing';
import { SaasSubscription } from './saas-subscription';
import { AfterViewChecked, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { SaasStorefrontFields, SaasStorefrontSettings } from '../../core/models/saas-storefront.model';
import { SaasUsage } from './saas-usage';
const defaults = (): SaasStorefrontFields => ({ brandTheme: 'gold', brandMark: '', pickupReservationMinutes: 30, acceptCustomerOrders: false, published: false, tagline: '', description: '', contactPhone: '', contactEmail: '', address: '', openingHours: '', showUnavailable: false });

@Component({ selector: 'app-saas-settings', imports: [SaasMedia, SaasBrandHeader, FormsModule, RouterLink, SaasUsage, SaasSubscription, SaasBilling], templateUrl: './saas-settings.html', styleUrl: './saas-lab.scss' })
export class SaasSettings implements OnChanges, OnDestroy, AfterViewChecked {
  protected readonly staging = environment.saasPreview;
  @Input({ required: true }) bakeryId!: string;
  @Input({ required: true }) slug!: string;
  @Input() bakeryName = '';
  @ViewChild('settingsDialog') private dialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private generation = 0;
  protected readonly current = signal<SaasStorefrontSettings | null>(null);
  protected readonly review = signal<SaasStorefrontFields | null>(null);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly menuLink = signal<string | null>(null);
  protected readonly notice = signal('');
  protected form = defaults();
  ngOnChanges() { void this.load(); }
  ngOnDestroy() { this.generation++; this.dialog?.nativeElement.close(); }
  ngAfterViewChecked() { const dialog = this.dialog?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); }
  protected cancel(event?: Event) { event?.preventDefault(); if (!this.busy()) this.review.set(null); }
  protected async load() {
    const generation = ++this.generation; this.current.set(null); this.menuLink.set(null); this.review.set(null); this.form = defaults();
    this.error.set(''); this.notice.set(''); this.loading.set(true); this.busy.set(false);
    try { const settings = await firstValueFrom(this.api.storefrontSettings(this.bakeryId)); if (generation !== this.generation) return; this.current.set(settings); const { version, ...form } = settings; this.form = { ...defaults(), ...form }; }
    catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  protected async showLink() {
   if(this.busy()||this.loading()||!this.current())return;const generation=this.generation;this.busy.set(true);this.error.set('');this.menuLink.set(null);
   try{const link=await firstValueFrom(this.api.storefrontLink(this.bakeryId).pipe(timeout(15000)));if(generation!==this.generation)return;const url=environment.saasPreview?validStagingMenuLink(link.url,this.slug,location.origin):validLocalMenuLink(link.url,this.slug);if(!url||link.scope!==(environment.saasPreview?'staging-preview':'local-preview'))throw new Error('Invalid local link');this.menuLink.set(url);}
   catch(error){if(generation===this.generation)this.failure(error);}finally{if(generation===this.generation)this.busy.set(false);}
  }
  protected async copyLink(){const url=this.menuLink();if(!url||this.busy()||this.loading())return;const generation=this.generation;this.notice.set('');this.error.set('');try{await navigator.clipboard.writeText(url);if(generation===this.generation)this.notice.set(environment.saasPreview?'Test menu link copied.':'Local menu link copied. It works only on the configured local server.');}catch{if(generation===this.generation)this.error.set('Clipboard unavailable. Select and copy the displayed local link.');}}
  protected prepare() { if (this.current() && !this.busy() && !this.loading()) { this.error.set(''); this.review.set({ ...this.form, brandMark: this.form.brandMark.trim().toUpperCase() }); } }
  private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Could not save settings. Reload and retry.'); }
  protected async confirm() {
    const data = this.review(), current = this.current(); if (!data || !current || this.busy()) return;
    const generation = this.generation; this.busy.set(true); this.error.set('');
    try {
      const saved = await firstValueFrom(this.api.updateStorefront(this.bakeryId, { ...data, expectedVersion: current.version }));
      if (generation !== this.generation) return; this.current.set(saved); const { version, ...form } = saved; this.form = { ...defaults(), ...form }; this.review.set(null);
      this.notice.set(saved.published ? 'Local menu preview enabled with these details.' : 'Settings saved. The local menu preview is disabled.');
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
