import { Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { CartQuote } from '../../core/models/cart.model';
import { ShopService } from '../../core/services/shop.service';
import { whatsappChatUrl, whatsappOrderMessage } from '../../core/utils/whatsapp';
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
  protected shop = inject(ShopService);

  private readonly quote = signal<CartQuote | null>(null);
  private readonly quotedKey = signal('');
  private readonly requestKey = computed(() => JSON.stringify(this.cart.payload()));
  private readonly refresh = signal(0);
  protected readonly pricing = computed(() => this.quote()?.pricing ?? null);
  protected readonly pricingLoading = signal(false);
  protected readonly pricingError = signal('');
  protected readonly summaryItems = computed(() => this.cart.items().map((item) => {
    const priced = this.quotedKey() === this.requestKey() ? this.quote()?.items.find((line) => line.product === item.productId) : undefined;
    return { ...item, name: priced?.name ?? item.name, price: priced?.price ?? item.price, lineTotal: priced?.lineTotal ?? item.price * item.quantity };
  }));
  protected readonly whatsappCheckoutUrl = computed(() => {
    const quote = this.quote();
    return quote && !this.cart.isEmpty() && !this.pricingLoading() && this.quotedKey() === this.requestKey()
      ? whatsappChatUrl(this.shop.info()?.contactPhone || '', whatsappOrderMessage(quote)) : null;
  });
  private seq = 0;

  /** Warm photo for the empty-cart state (presentation only). */
  protected readonly emptyImage = categoryImage('Pastries');

  constructor() {
    this.shop.load();
    // Re-price on the server whenever the cart changes (authoritative totals).
    effect((onCleanup) => {
      const items = this.cart.items();
      const key = this.requestKey();
      this.refresh();
      const ticket = ++this.seq;
      this.quote.set(null);
      this.quotedKey.set('');
      this.pricingError.set('');
      if (items.length === 0) {
        this.pricingLoading.set(false);
        return;
      }
      this.pricingLoading.set(true);
      const subscription = this.cart.price().subscribe({
        next: (res) => {
          if (ticket === this.seq) {
            this.quote.set(res);
            this.quotedKey.set(key);
            this.pricingLoading.set(false);
          }
        },
        error: (err) => {
          if (ticket === this.seq) {
            this.pricingLoading.set(false);
            this.pricingError.set(err.error?.message || 'Could not update prices. Please try again.');
          }
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected retryPricing() { this.refresh.update((value) => value + 1); }
}
