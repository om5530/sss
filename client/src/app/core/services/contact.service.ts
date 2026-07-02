import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ContactService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  /** Sends a contact-form enquiry; staff triage it in the admin panel. */
  send(payload: { name: string; email: string; message: string }) {
    return this.http.post<{ success: boolean }>(`${this.base}/contact`, payload);
  }
}
