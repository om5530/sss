import { Component, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { CartPricing } from '../../core/models/cart.model';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { categoryImage } from '../../core/utils/food-image';

@Component({
  selector: 'app-cart',
  imports: [RouterLink, DecimalPipe, RevealOnScroll],
  templateUrl: './cart.html',
  styleUrl: './cart.scss',
})
export class Cart {
  protected cart = inject(CartService);
  protected auth = inject(AuthService);

  protected readonly pricing = signal<CartPricing | null>(null);
  protected readonly pricingLoading = signal(false);
  private seq = 0;

  /** Warm photo for the empty-cart state (presentation only). */
  protected readonly emptyImage = categoryImage('Pastries');

  constructor() {
    // Re-price on the server whenever the cart changes (authoritative totals).
    effect(() => {
      const items = this.cart.items();
      if (items.length === 0) {
        this.pricing.set(null);
        return;
      }
      const ticket = ++this.seq;
      this.pricingLoading.set(true);
      this.cart.price().subscribe({
        next: (res) => {
          if (ticket === this.seq) {
            this.pricing.set(res.pricing);
            this.pricingLoading.set(false);
          }
        },
        error: () => {
          if (ticket === this.seq) this.pricingLoading.set(false);
        },
      });
    });
  }
}
