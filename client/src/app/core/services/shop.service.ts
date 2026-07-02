import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface ShopInfo {
  opensAt: string;
  closesAt: string;
  openNow: boolean;
  timezone: string;
}

/** Opening hours + open-now, fetched once per session and shared. */
@Injectable({ providedIn: 'root' })
export class ShopService {
  private http = inject(HttpClient);

  readonly info = signal<ShopInfo | null>(null);
  private loaded = false;

  /** Safe to call from any page — only hits the API once. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.http.get<{ shop: ShopInfo }>(`${environment.apiUrl}/shop`).subscribe({
      next: (res) => this.info.set(res.shop),
      error: () => {
        this.loaded = false; // allow a retry on the next page that asks
      },
    });
  }
}
