import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Category, Menu, Product, Review, ReviewListResponse } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getMenu() {
    return this.http.get<{ menu: Menu }>(`${this.base}/products/menu`).pipe(map((r) => r.menu));
  }

  list(filters: { group?: string; category?: string; q?: string; featured?: boolean } = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http
      .get<{ products: Product[] }>(`${this.base}/products`, { params })
      .pipe(map((r) => r.products));
  }

  getBySlug(slug: string) {
    return this.http
      .get<{ product: Product }>(`${this.base}/products/${slug}`)
      .pipe(map((r) => r.product));
  }

  getCategories() {
    return this.http
      .get<{ categories: Category[] }>(`${this.base}/products/categories`)
      .pipe(map((r) => r.categories));
  }

  /* ---- Reviews (verified purchase) ---- */

  reviews(slug: string) {
    return this.http.get<ReviewListResponse>(`${this.base}/products/${slug}/reviews`);
  }

  submitReview(slug: string, payload: { rating: number; text: string }) {
    return this.http
      .post<{ review: Review }>(`${this.base}/products/${slug}/reviews`, payload)
      .pipe(map((r) => r.review));
  }
}
