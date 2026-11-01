import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SaasCustomer, SaasCustomerCart, SaasCustomerSubmit, SaasCustomerQuote, SaasCustomerOrder } from '../models/saas-customer.model';
@Injectable({ providedIn: 'root' })
export class SaasCustomerService {
  private readonly http = inject(HttpClient);
  private readonly mutation = { withCredentials: true, headers: { 'X-Saas-Customer': '1' } };
  private scoped(customer: string) { return { withCredentials: true, headers: { 'X-Saas-Customer': '1', 'X-Saas-Customer-Id': customer } }; }
  private base(slug: string) { return `${environment.apiUrl}/saas/storefront/${encodeURIComponent(slug)}/customer`; }
  me(slug: string) { return this.http.get<{ customer: SaasCustomer }>(`${this.base(slug)}/me`, { withCredentials: true }).pipe(map(r => r.customer)); }
  register(slug: string, input: { email: string; password: string; displayName: string }) { return this.http.post<{ customer: SaasCustomer }>(`${this.base(slug)}/register`, input, this.mutation).pipe(map(r => r.customer)); }
  login(slug: string, input: { email: string; password: string }) { return this.http.post<{ customer: SaasCustomer }>(`${this.base(slug)}/login`, input, this.mutation).pipe(map(r => r.customer)); }
  logout(slug: string, customer: string) { return this.http.post(`${this.base(slug)}/logout`, {}, this.scoped(customer)); }
  requestReset(slug: string, email: string) { return this.http.post<{ message: string }>(`${this.base(slug)}/password-reset/request`, { email }, this.mutation); }
  resetPassword(slug: string, token: string, newPassword: string) { return this.http.post<{ message: string }>(`${this.base(slug)}/password-reset/confirm`, { token, newPassword }, this.mutation); }
  requestVerification(slug: string, customer: string) { return this.http.post<{ message: string }>(`${this.base(slug)}/email-verification/request`, {}, this.scoped(customer)); }
  confirmVerification(slug: string, token: string) { return this.http.post<{ message: string }>(`${this.base(slug)}/email-verification/confirm`, { token }, this.mutation); }
  changePassword(slug: string, customer: string, currentPassword: string, newPassword: string) { return this.http.post<{ message: string }>(`${this.base(slug)}/password/change`, { currentPassword, newPassword, confirmed: true }, this.scoped(customer)); }
  quote(slug: string, customer: string, input: SaasCustomerCart) { return this.http.post<{ quote: SaasCustomerQuote }>(`${this.base(slug)}/orders/quote`, input, this.scoped(customer)).pipe(map(r => r.quote)); }
  order(slug: string, customer: string, input: SaasCustomerSubmit) { return this.http.post<{ order: SaasCustomerOrder; replayed: boolean }>(`${this.base(slug)}/orders`, input, this.scoped(customer)); }
  refreshReservations(slug: string, customer: string) { return this.http.post<{ availabilityChanged: boolean; hasMore: boolean }>(`${this.base(slug)}/reservations/refresh`, {}, this.scoped(customer)); }
  cancelOrder(slug: string, customer: string, orderId: string, expectedVersion: number, reason: string) { return this.http.post<{ alreadyClosed: boolean; order: { reservationStatus: 'cancelled' | 'expired' } }>(`${this.base(slug)}/orders/${encodeURIComponent(orderId)}/cancel`, { expectedVersion, reason, confirmed: true }, this.scoped(customer)); }
  orders(slug: string, customer: string, cursor?: string) { return this.http.get<{ orders: SaasCustomerOrder[]; nextCursor: string | null }>(`${this.base(slug)}/orders`, { ...this.scoped(customer), params: cursor ? { cursor } : {} }); }
}
