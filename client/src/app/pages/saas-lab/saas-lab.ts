import { SaasMedia } from './saas-media';
import { environment } from '../../../environments/environment';
import { AdminThemeService } from '../../core/services/admin-theme.service';
import { RouterLink } from '@angular/router';
import { AfterViewChecked, Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasService } from '../../core/services/saas.service';
import { BakeryContext, BakeryMembership } from '../../core/models/saas.model';
import { SaasProduct, SaasProductFilters } from '../../core/models/saas-product.model';
import { SaasRecipes } from './saas-recipes';
import { SaasSales } from './saas-sales';
import { SaasSettings } from './saas-settings';
import { SaasInventory } from './saas-inventory';
import { SaasProduction } from './saas-production';
import { SaasStockHistory } from './saas-stock-history';
import { SaasTeam } from './saas-team';
import { SaasInvitePreview } from '../../core/models/saas-team.model';

@Component({
  selector: 'app-saas-lab',
  imports: [SaasMedia, FormsModule, CurrencyPipe, RouterLink, SaasRecipes, SaasSales, SaasSettings, SaasTeam, SaasStockHistory, SaasProduction, SaasInventory],
  templateUrl: './saas-lab.html',
  styleUrls: ['./saas-lab.scss', '../admin/layout/admin-layout.scss', './saas-shell.scss'],
})
export class SaasLab implements AfterViewChecked {
  protected readonly staging = environment.saasPreview;
  protected readonly theme = inject(AdminThemeService, { optional: true });
  protected readonly mobileNavOpen = signal(false);
  protected readonly sidebarCollapsed = signal(false);
  protected readonly bakeryOpen = signal(true);
  protected readonly managing = signal(false);
  protected readonly mobileViewport = signal(false);
  protected navigate(tab: 'products' | 'recipes' | 'sales' | 'settings' | 'team' | 'production' | 'inventory') {
    this.tab.set(tab); this.managing.set(false); this.closeMenu();
    if (tab === 'products') void this.loadProducts();
  }
  protected openMenu() { this.bakeryOpen.set(false); this.mobileNavOpen.set(true); setTimeout(() => document.getElementById('workspace-menu-close')?.focus()); }
  protected closeMenu() { this.mobileNavOpen.set(false); document.getElementById('workspace-menu-toggle')?.focus(); }
  protected menuKeydown(event: KeyboardEvent) {
    if (!this.mobileViewport() || !this.mobileNavOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closeMenu(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('#workspace-menu a[href], #workspace-menu button, #workspace-menu select')).filter(el => !el.hasAttribute('disabled') && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  protected toggleSidebar() {
    this.sidebarCollapsed.update(value => !value);
    try { localStorage.setItem('gb_saas_sidebar_collapsed', String(this.sidebarCollapsed())); } catch {}
  }
  @ViewChild('bakeryDialog') private bakeryDialog?: ElementRef<HTMLDialogElement>;
  protected readonly bakeryReview = signal<{ name: string; slug: string } | null>(null);
  @ViewChild('archiveDialog') private archiveDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('joinDialog') private joinDialog?: ElementRef<HTMLDialogElement>;
  private readonly api = inject(SaasService);
  private generation = 0;
  private alive = true;
  protected readonly bakeries = signal<BakeryMembership[]>([]);
  protected readonly selected = signal<BakeryContext | null>(null);
  protected readonly products = signal<SaasProduct[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly unavailable = signal(false);
  protected readonly editor = signal<SaasProduct | 'new' | null>(null);
  protected readonly mediaTarget = signal<SaasProduct | null>(null);
  protected readonly stockTarget = signal<SaasProduct | null>(null);
  protected readonly archiveTarget = signal<SaasProduct | null>(null);
  protected readonly owner = computed(() => this.selected()?.role === 'owner');
  protected readonly tab = signal<'products' | 'recipes' | 'sales' | 'settings' | 'team' | 'production' | 'inventory'>('products');
  protected readonly invitePreview = signal<SaasInvitePreview | null>(null);
  protected inviteToken = '';
  private reviewedInviteToken = '';
  protected bakeryForm = { name: '', slug: '' };
  protected search = '';
  protected archived: 'active' | 'archived' | 'all' = 'active';
  protected form = { name: '', slug: '', category: '', price: '', stock: '', description: '', available: true, stockCountConfirmed: false };

  constructor() {
    // Browser-only layout setup; component logic also runs in the API/unit harness.
    if (typeof document !== 'undefined' && typeof matchMedia !== 'undefined') {
      document.documentElement.classList.add('adm-viewport');
      try { this.sidebarCollapsed.set(localStorage.getItem('gb_saas_sidebar_collapsed') === 'true'); } catch {}
      const query = matchMedia('(max-width: 960px)');
      const resize = () => { this.mobileViewport.set(query.matches); if (!query.matches) this.mobileNavOpen.set(false); };
      resize(); query.addEventListener('change', resize);
      inject(DestroyRef).onDestroy(() => { query.removeEventListener('change', resize); document.documentElement.classList.remove('adm-viewport'); });
    }
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.generation++; this.inviteToken = ''; this.reviewedInviteToken = ''; this.invitePreview.set(null); });
    void this.loadBakeries();
  }

  ngAfterViewChecked() {
    const bakery = this.bakeryDialog?.nativeElement; if (bakery && !bakery.open) bakery.showModal();
    const dialog = this.archiveDialog?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    const join = this.joinDialog?.nativeElement;
    if (join && !join.open) join.showModal();
  }

  protected cancelArchive(event: Event) {
    event.preventDefault();
    if (!this.busy()) this.archiveTarget.set(null);
  }
  protected cancelJoin(event?: Event) { event?.preventDefault(); if (!this.busy()) { this.invitePreview.set(null); this.reviewedInviteToken = ''; } }
  protected async inspectInvite() {
    if (this.busy() || this.loading()) return;
    const token = this.inviteToken.trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) { this.error.set('Paste the full staff invite code.'); return; }
    this.busy.set(true); this.error.set(''); this.invitePreview.set(null); this.reviewedInviteToken = '';
    try { const preview = await firstValueFrom(this.api.inspectInvitation(token)); if (!this.alive) return; this.reviewedInviteToken = token; this.invitePreview.set(preview); }
    catch (error) { if (this.alive) this.error.set(this.message(error)); }
    finally { if (this.alive) this.busy.set(false); }
  }
  protected async acceptInvite() {
    if (!this.invitePreview() || !this.reviewedInviteToken || this.busy()) return;
    this.busy.set(true); this.error.set(''); let joined: BakeryContext | undefined;
    try {
      const result = await firstValueFrom(this.api.acceptInvitation(this.reviewedInviteToken)); if (!this.alive) return;
      joined = { ...result.bakery, role: result.role };
      this.bakeries.update(rows => rows.some(row => row._id === joined!._id) ? rows.map(row => row._id === joined!._id ? joined! : row) : [...rows, joined!]);
      this.invitePreview.set(null); this.reviewedInviteToken = ''; this.inviteToken = '';
    } catch (error) { if (this.alive) this.error.set(this.message(error)); }
    finally { if (this.alive) this.busy.set(false); }
    if (joined && this.alive) await this.selectBakery(joined._id);
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.error?.details?.code === 'SAAS_LIMIT_REACHED' && typeof error.error?.message === 'string') return error.error.message;
      if (error.status === 409) return 'This item changed or its slug is already in use. Reload the catalogue before saving again.';
      if (error.status === 403 || error.status === 404) return 'This workspace is unavailable or your access has changed.';
      if (error.status === 0) return 'Could not connect. Check your local server and retry.';
      return typeof error.error?.message === 'string' ? error.error.message : 'Could not save the change. Please retry.';
    }
    return 'Something went wrong. Please retry.';
  }

  protected async loadBakeries() {
    if (this.busy() || this.loading()) return;
    this.loading.set(true); this.error.set(''); this.unavailable.set(false);
    try {
      const bakeries = await firstValueFrom(this.api.bakeries());
      if (!this.alive) return;
      this.bakeries.set(bakeries);
      if (bakeries.length === 1) {
        this.loading.set(false);
        await this.selectBakery(bakeries[0]._id);
      }
    } catch (error) {
      if (!this.alive) return;
      this.error.set(this.message(error));
      this.unavailable.set(true);
    } finally { if (this.alive) this.loading.set(false); }
  }

  protected async selectBakery(id: string) {
    if (this.busy()) return;
    this.cancelJoin(); this.inviteToken = '';
    const generation = ++this.generation;
    this.selected.set(null); this.mediaTarget.set(null); this.stockTarget.set(null); this.products.set([]); this.nextCursor.set(null);
    this.tab.set('sales'); this.managing.set(false); this.mobileNavOpen.set(false);
    this.editor.set(null); this.archiveTarget.set(null); this.search = ''; this.archived = 'active';
    this.error.set(''); this.notice.set('');
    if (!id) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const context = await firstValueFrom(this.api.bakeryContext(id));
      if (!this.alive || generation !== this.generation) return;
      const page = await firstValueFrom(this.api.products(id));
      if (!this.alive || generation !== this.generation) return;
      this.selected.set(context); this.products.set(page.products); this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (this.alive && generation === this.generation) this.error.set(this.message(error));
    } finally { if (this.alive && generation === this.generation) this.loading.set(false); }
  }

  protected reviewBakery() { if (!this.busy() && !this.loading() && !this.unavailable()) this.bakeryReview.set({ ...this.bakeryForm }); }
  protected cancelBakery(event?: Event) { event?.preventDefault(); if (!this.busy()) this.bakeryReview.set(null); }
  protected async createBakery() {
    if (!this.bakeryReview() || this.busy() || this.loading() || this.unavailable()) return;
    this.busy.set(true); this.error.set('');
    let created: BakeryContext | undefined;
    try {
      created = await firstValueFrom(this.api.createBakery({ ...this.bakeryReview()! }));
      if (!this.alive) return;
      this.bakeries.update(items => [...items, created!]); this.bakeryForm = { name: '', slug: '' }; this.bakeryReview.set(null);
    } catch (error) { if (this.alive) this.error.set(this.message(error)); }
    finally { if (this.alive) this.busy.set(false); }
    if (this.alive && created) await this.selectBakery(created._id);
  }

  protected async loadProducts(more = false) {
    const selected = this.selected();
    if (!selected || this.loading() || this.busy()) return;
    const generation = this.generation;
    this.loading.set(true); this.error.set(''); this.editor.set(null); this.stockTarget.set(null);
    const filters: SaasProductFilters = { search: this.search, archived: this.archived };
    if (more && this.nextCursor()) filters.cursor = this.nextCursor()!;
    try {
      const page = await firstValueFrom(this.api.products(selected._id, filters));
      if (!this.alive || generation !== this.generation) return;
      this.products.set(more ? [...this.products(), ...page.products] : page.products); this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (this.alive && generation === this.generation) {
        this.products.set([]); this.nextCursor.set(null); this.error.set(this.message(error));
      }
    } finally { if (this.alive && generation === this.generation) this.loading.set(false); }
  }

  protected edit(product: SaasProduct | 'new') {
    if (!this.owner() || this.busy() || this.loading()) return;
    this.error.set(''); this.notice.set(''); this.editor.set(product);
    this.form = product === 'new'
      ? { name: '', slug: '', category: '', price: '', stock: '', description: '', available: true, stockCountConfirmed: false }
      : { name: product.name, slug: product.slug, category: product.category, price: (product.pricePaise / 100).toFixed(2),
        stock: product.stockCount === null ? '' : String(product.stockCount), description: product.description, available: product.available, stockCountConfirmed: false };
  }

  protected async saveProduct() {
    const bakery = this.selected(), editor = this.editor();
    if (!bakery || !editor || !this.owner() || this.busy()) return;
    // Parse decimal strings into integer paise, never round user input silently.
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(this.form.price)
      || (this.form.stock !== '' && !/^\d{1,7}$/.test(this.form.stock))) {
      this.error.set('Enter a price with up to two decimal places and a whole-number stock count.'); return;
    }
    const [rupees, fraction = ''] = this.form.price.split('.');
    const pricePaise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
    const stockCount = this.form.stock === '' ? null : Number(this.form.stock);
    if (pricePaise > 100000000 || (stockCount !== null && stockCount > 1000000)) {
      this.error.set('Price or stock exceeds the supported maximum.'); return;
    }
    this.busy.set(true); this.error.set('');
    const data = { name: this.form.name, slug: this.form.slug, category: this.form.category, pricePaise,
      stockCount, description: this.form.description, available: this.form.available };
    let saved = false;
    try {
      await firstValueFrom(editor === 'new' ? this.api.createProduct(bakery._id, data)
        : this.api.updateProduct(bakery._id, editor._id, { ...data, expectedVersion: editor.version, ...(this.form.stockCountConfirmed ? { stockCountConfirmed: true as const } : {}) }));
      if (!this.alive) return;
      this.editor.set(null); this.notice.set('Product saved.'); saved = true;
    } catch (error) { if (this.alive) this.error.set(this.message(error)); }
    finally { if (this.alive) this.busy.set(false); }
    if (saved && this.alive) await this.loadProducts();
  }

  protected async confirmArchive() {
    const product = this.archiveTarget(), bakery = this.selected();
    if (!product || !bakery || !this.owner() || this.busy()) return;
    this.busy.set(true); this.error.set('');
    let saved = false;
    try {
      await firstValueFrom(this.api.updateProduct(bakery._id, product._id, { archived: !product.archived, expectedVersion: product.version }));
      if (!this.alive) return;
      this.archiveTarget.set(null); this.notice.set(product.archived ? 'Product restored.' : 'Product archived.'); saved = true;
    } catch (error) { if (this.alive) this.error.set(this.message(error)); }
    finally { if (this.alive) this.busy.set(false); }
    if (saved && this.alive) await this.loadProducts();
  }
}
