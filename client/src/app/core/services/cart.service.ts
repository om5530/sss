import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CartItem, CartPricing } from '../models/cart.model';
import { Product } from '../models/product.model';
import { OrderType } from '../models/order.model';
import { foodImage, isPlaceholderImage } from '../utils/food-image';

const CART_KEY = 'bc_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  readonly items = signal<CartItem[]>(this.load());
  readonly count = computed(() => this.items().reduce((n, i) => n + i.quantity, 0));
  readonly subtotal = computed(() =>
    this.items().reduce((sum, i) => sum + i.price * i.quantity, 0),
  );
  readonly isEmpty = computed(() => this.items().length === 0);

  constructor() {
    // Persist the cart to localStorage whenever it changes.
    effect(() => localStorage.setItem(CART_KEY, JSON.stringify(this.items())));
  }

  add(product: Product, quantity = 1) {
    this.items.update((items) => {
      const existing = items.find((i) => i.productId === product._id);
      if (existing) {
        return items.map((i) =>
          i.productId === product._id ? { ...i, quantity: i.quantity + quantity } : i,
        );
      }
      return [
        ...items,
        {
          productId: product._id,
          slug: product.slug,
          name: product.name,
          price: product.price,
          image: isPlaceholderImage(product.image) ? foodImage(product) : product.image,
          quantity,
        },
      ];
    });
  }

  setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) return this.remove(productId);
    this.items.update((items) =>
      items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
    );
  }

  increment(productId: string) {
    const item = this.items().find((i) => i.productId === productId);
    if (item) this.setQuantity(productId, item.quantity + 1);
  }

  decrement(productId: string) {
    const item = this.items().find((i) => i.productId === productId);
    if (item) this.setQuantity(productId, item.quantity - 1);
  }

  quantityOf(productId: string): number {
    return this.items().find((i) => i.productId === productId)?.quantity ?? 0;
  }

  remove(productId: string) {
    this.items.update((items) => items.filter((i) => i.productId !== productId));
  }

  clear() {
    this.items.set([]);
  }

  /** Server-side re-pricing — authoritative totals (subtotal, discount, tax, delivery). */
  price(orderType?: OrderType, couponCode?: string) {
    return this.http.post<{ items: unknown[]; pricing: CartPricing }>(`${this.base}/cart/price`, {
      items: this.payload(),
      orderType,
      couponCode: couponCode || undefined,
    });
  }

  payload() {
    return this.items().map((i) => ({ productId: i.productId, quantity: i.quantity }));
  }

  private load(): CartItem[] {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
    } catch {
      return [];
    }
  }
}
