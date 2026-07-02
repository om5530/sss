import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../../core/models/product.model';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { foodImage, isPlaceholderImage } from '../../../core/utils/food-image';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink],
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
})
export class ProductCard {
  readonly product = input.required<Product>();

  private cart = inject(CartService);
  private toast = inject(ToastService);

  protected readonly quantity = computed(() => this.cart.quantityOf(this.product()._id));

  protected readonly imageUrl = computed(() => {
    const product = this.product();
    return isPlaceholderImage(product.image) ? foodImage(product) : product.image;
  });

  /** Tracked stock running low — nudge the fence-sitters. */
  protected readonly lowStock = computed(() => {
    const p = this.product();
    return p.available && p.stockCount != null && p.stockCount > 0 && p.stockCount <= 5;
  });

  onImageError(event: Event) {
    const el = event.target as HTMLImageElement;
    const fallback = foodImage(this.product());
    if (el.src !== fallback) el.src = fallback;
  }

  add(event: Event) {
    event.stopPropagation();
    this.cart.add(this.product());
    this.toast.success(`${this.product().name} added to cart`);
  }

  increment(event: Event) {
    event.stopPropagation();
    this.cart.increment(this.product()._id);
  }

  decrement(event: Event) {
    event.stopPropagation();
    this.cart.decrement(this.product()._id);
  }
}
