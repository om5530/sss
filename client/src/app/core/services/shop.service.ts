import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface ShopInfo {
  opensAt: string;
  closesAt: string;
  openNow: boolean;
  timezone: string;
  contactAddress: string;
  contactPhone: string;
  contactEmail: string;
}

/** Shared shop details, refreshed when storefront pages request them. */
@Injectable({ providedIn: 'root' })
export class ShopService {
  private http = inject(HttpClient);

  readonly info = signal<ShopInfo | null>(null);
  private loading = false;

  /** Coalesces concurrent component requests without caching for the session. */
  load(): void {
    if (this.loading) return;
    this.loading = true;
    this.http.get<{ shop: ShopInfo }>(`${environment.apiUrl}/shop`).subscribe({
      next: (res) => { this.info.set(res.shop); this.loading = false; },
      error: () => {
        this.loading = false;
      },
    });
  }
}
