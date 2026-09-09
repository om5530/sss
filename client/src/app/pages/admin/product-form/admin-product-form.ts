import { Component, computed, effect, inject, input, signal, DestroyRef } from '@angular/core';
import { AdminSessionService } from '../../../core/services/admin-session.service';
import { AuthService } from '../../../core/services/auth.service';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, ManagedCategory } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';

interface ApiFieldError {
  field: string;
  message: string;
}

@Component({
  selector: 'app-admin-product-form',
  imports: [RouterLink, FormsModule],
  templateUrl: './admin-product-form.html',
})
export class AdminProductForm {
  /** Present in edit mode (route param), absent on /products/new. */
  readonly id = input<string>();

  private admin = inject(AdminService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private ownerId = this.auth.user()?.id;
  private baseline = '';
  private draftKey() { return `admin-product-draft:${this.ownerId}:${this.id() || 'new'}`; }
  private snapshot() { return { name: this.name, group: this.group, category: this.category, description: this.description,
    price: this.price, image: this.image, dietary: this.dietary, tags: this.tags, available: this.available,
    featured: this.featured, stockCount: this.stockCount }; }
  private dirty() { return !!this.baseline && JSON.stringify(this.snapshot()) !== this.baseline; }
  private keepDraft() {
    try {
      if (this.dirty()) sessionStorage.setItem(this.draftKey(), JSON.stringify({ fields: this.snapshot(), loadedAt: this.loadedAt }));
    } catch { this.toast.error('Browser storage is unavailable; your draft could not be kept.'); }
  }
  private restoreDraft() {
    this.baseline = JSON.stringify(this.snapshot());
    try {
      const draft = JSON.parse(sessionStorage.getItem(this.draftKey()) || 'null');
      if (draft?.fields) {
        for (const key of Object.keys(this.snapshot())) if (key in draft.fields) (this as any)[key] = draft.fields[key];
        this.loadedAt = draft.loadedAt;
        this.toast.info('Your unsaved product draft was restored. Review it before saving.');
      }
    } catch { this.clearDraft(); }
  }
  private clearDraft() { try { sessionStorage.removeItem(this.draftKey()); } catch { /* Storage may be disabled. */ } }
  canLeave() {
    if (!this.auth.isAuthenticated() || !this.dirty()) return true;
    if (!window.confirm('Discard unsaved product changes?')) return false;
    this.clearDraft();
    return true;
  }

  protected readonly isEdit = computed(() => !!this.id());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly categories = signal<ManagedCategory[]>([]);

  // Form model
  protected name = '';
  protected group: 'bakery' | 'savoury' = 'bakery';
  protected category = '';
  protected description = '';
  protected price: number | null = null;
  protected image = '';
  protected dietary: 'veg' | 'non-veg' | 'egg' = 'veg';
  protected tags = '';
  protected available = true;
  protected featured = false;
  /** Daily bake count; blank = not tracked (availability stays manual). */
  protected stockCount: number | null = null;

  /** For the optimistic-concurrency check on save (AS-10.2). */
  private loadedAt: string | undefined;

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(inject(AdminSessionService).preserveDraft(() => this.keepDraft()));
    const unload = (event: BeforeUnloadEvent) => { if (this.dirty()) { this.keepDraft(); event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    destroy.onDestroy(() => window.removeEventListener('beforeunload', unload));
    this.admin.categories().subscribe({
      next: (categories) => this.categories.set(categories.filter((c) => !c.archived)),
      error: () => this.toast.error('Could not load categories. Reload before saving.'),
    });

    effect(() => {
      const id = this.id();
      if (id) this.load(id);
      else this.restoreDraft();
    });
  }

  private load(id: string) {
    this.loading.set(true);
    this.admin.product(id).subscribe({
      next: (p) => {
        this.name = p.name;
        this.group = p.group;
        this.category = p.category;
        this.description = p.description;
        this.price = p.price;
        this.image = p.image;
        this.dietary = p.dietary;
        this.tags = (p.tags || []).join(', ');
        this.available = p.available;
        this.featured = p.featured;
        this.stockCount = p.stockCount ?? null;
        this.loadedAt = p.updatedAt;
        this.restoreDraft();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Could not load that product.');
        this.router.navigateByUrl('/admin/products');
      },
    });
  }

  /** Uploads a photo file and drops the returned URL into the image field. */
  onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file || this.uploading()) return;

    this.uploading.set(true);
    this.admin.uploadImage(file).subscribe({
      next: (url) => {
        this.uploading.set(false);
        this.image = url;
        this.toast.success('Photo uploaded.');
      },
      error: (err) => {
        this.uploading.set(false);
        this.toast.error(err.error?.message || 'Upload failed — try a JPEG/PNG under 5 MB.');
      },
    });
  }

  save() {
    if (this.saving()) return;
    this.fieldErrors.set({});
    this.saving.set(true);

    const data: Partial<Product> & { ifUnmodifiedSince?: string } = {
      name: this.name.trim(),
      group: this.group,
      category: this.category.trim(),
      description: this.description.trim(),
      price: Number(this.price),
      image: this.image.trim(),
      dietary: this.dietary,
      tags: this.tags.split(',').map((t) => t.trim()).filter(Boolean),
      available: this.available,
      featured: this.featured,
      // '' from a cleared number input means "stop tracking".
      stockCount: this.stockCount === null || (this.stockCount as unknown) === '' ? null : Number(this.stockCount),
    };

    const id = this.id();
    if (id) data.ifUnmodifiedSince = this.loadedAt;

    const request = id ? this.admin.updateProduct(id, data) : this.admin.createProduct(data);
    request.subscribe({
      next: (product) => {
        this.clearDraft();
        this.baseline = JSON.stringify(this.snapshot());
        this.saving.set(false);
        this.toast.success(`"${product.name}" saved — it's live on the menu.`);
        this.router.navigateByUrl('/admin/products');
      },
      error: (err) => {
        this.saving.set(false);
        const details: ApiFieldError[] = err.error?.details || [];
        if (details.length) {
          this.fieldErrors.set(Object.fromEntries(details.map((d) => [d.field, d.message])));
        } else {
          this.toast.error(err.error?.message || 'Could not save the product.');
        }
      },
    });
  }
}
