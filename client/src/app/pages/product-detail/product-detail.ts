import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ProductService } from '../../core/services/product.service';
import { CartService } from '../../core/services/cart.service';
import { SeoService } from '../../core/services/seo.service';
import { ToastService } from '../../core/services/toast.service';
import { Product, Review } from '../../core/models/product.model';
import { foodImage, isPlaceholderImage } from '../../core/utils/food-image';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { Tilt } from '../../shared/directives/tilt.directive';
import { Magnetic } from '../../shared/directives/magnetic.directive';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, DatePipe, FormsModule, RevealOnScroll, Tilt, Magnetic],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetail {
  readonly slug = input.required<string>();

  private products = inject(ProductService);
  private cart = inject(CartService);
  private toast = inject(ToastService);
  private seo = inject(SeoService);
  protected auth = inject(AuthService);

  protected readonly product = signal<Product | null>(null);
  protected readonly loading = signal(true);
  protected readonly quantity = signal(1);

  /* ---- Reviews ---- */
  protected readonly reviews = signal<Review[]>([]);
  protected readonly canReview = signal(false);
  protected readonly submittingReview = signal(false);
  protected reviewRating = 0;
  protected reviewText = '';

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.loading.set(true);
      this.products.getBySlug(slug).subscribe({
        next: (product) => {
          this.product.set(product);
          this.loading.set(false);
          // Share-ready meta: real name, description and photo for link previews.
          this.seo.set({
            title: `${product.name} — Sweet Savory Savor`,
            description: product.description || undefined,
            image: product.image || undefined,
          });
        },
        error: () => this.loading.set(false),
      });
      this.products.reviews(slug).subscribe({
        next: (res) => {
          this.reviews.set(res.reviews);
          this.canReview.set(res.eligible);
          if (res.myReview) {
            this.reviewRating = res.myReview.rating;
            this.reviewText = res.myReview.text;
          }
        },
        error: () => this.reviews.set([]),
      });
    });
  }

  submitReview() {
    const slug = this.slug();
    if (!this.reviewRating || this.submittingReview()) return;
    this.submittingReview.set(true);
    this.products.submitReview(slug, { rating: this.reviewRating, text: this.reviewText.trim() }).subscribe({
      next: () => {
        this.submittingReview.set(false);
        this.toast.success('Thanks — your review is live!');
        // Refresh list + the denormalised stars on the product.
        this.products.reviews(slug).subscribe({ next: (res) => this.reviews.set(res.reviews) });
        this.products.getBySlug(slug).subscribe({ next: (p) => this.product.set(p) });
      },
      error: (err) => {
        this.submittingReview.set(false);
        this.toast.error(err.error?.message || 'Could not save your review.');
      },
    });
  }

  /** Star fill for display (templates can't reach Math). */
  protected roundedRating(p: Product): number {
    return Math.round(p.ratingAvg || 0);
  }

  imageFor(product: Product): string {
    return isPlaceholderImage(product.image) ? foodImage(product) : product.image;
  }

  onImageError(event: Event, product: Product) {
    const el = event.target as HTMLImageElement;
    const fallback = foodImage(product);
    if (el.src !== fallback) el.src = fallback;
  }

  changeQty(delta: number) {
    this.quantity.update((q) => Math.max(1, q + delta));
  }

  addToCart() {
    const product = this.product();
    if (!product) return;
    this.cart.add(product, this.quantity());
    this.toast.success(`${this.quantity()}× ${product.name} added to cart`);
  }
}
