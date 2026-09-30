import { Injectable } from '@angular/core';
import { Product } from '../../../core/models/product.model';

// Scoped to the admin layout so a signed-out session cannot reuse its list.
@Injectable()
export class AdminProductListState {
  private key = '';
  private products: Product[] | null = null;
  private savedAt = 0;

  get(key: string): Product[] | null {
    return this.key === key && Date.now() - this.savedAt < 30_000
      ? this.products?.slice() ?? null
      : null;
  }

  set(key: string, products: Product[]) {
    this.key = key;
    this.products = products.slice();
    this.savedAt = Date.now();
  }

  upsertSaved(product: Product) {
    if (this.key !== 'default' || !this.products) return;
    const products = this.products.filter((item) => item._id !== product._id);
    if (!product.archived) products.push(product);
    products.sort((a, b) => a.group.localeCompare(b.group)
      || a.category.localeCompare(b.category)
      || a.name.localeCompare(b.name));
    this.set('default', products);
  }
}
