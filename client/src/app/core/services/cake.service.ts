import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CakeRequestPayload {
  name: string;
  phone: string;
  email?: string;
  occasion: string;
  servings: number;
  flavour: string;
  messageOnCake?: string;
  /** ISO date (yyyy-mm-dd is fine) — at least a day out. */
  dateNeeded: string;
  details?: string;
  referenceImage?: string;
}

@Injectable({ providedIn: 'root' })
export class CakeService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  /** Sends a custom-cake brief; staff triage + quote it in the admin panel. */
  submit(payload: CakeRequestPayload) {
    return this.http.post<{ success: boolean }>(`${this.base}/cake-requests`, payload);
  }

  /** Uploads a reference photo (≤5 MB, JPEG/PNG/WebP) → public URL. */
  uploadReference(file: File) {
    const form = new FormData();
    form.append('image', file);
    return this.http
      .post<{ url: string }>(`${this.base}/cake-requests/reference-image`, form)
      .pipe(map((r) => r.url));
  }
}
