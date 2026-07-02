import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateOrderPayload, Order } from '../models/order.model';

export interface PaymentIntentResponse {
  success: boolean;
  /** Which rail the server chose: Razorpay (live) → Stripe (legacy) → mock (dev). */
  provider: 'razorpay' | 'stripe' | 'mock';
  mock: boolean;
  // Razorpay (provider === 'razorpay')
  keyId?: string;
  razorpayOrderId?: string;
  /** Minor units (paise) — what Checkout.js expects. */
  amount?: number;
  currency?: string;
  orderNumber?: string;
  // Stripe (provider === 'stripe' | 'mock')
  clientSecret?: string;
  paymentIntentId?: string;
  stripeEnabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  create(payload: CreateOrderPayload) {
    return this.http.post<{ order: Order }>(`${this.base}/orders`, payload).pipe(map((r) => r.order));
  }

  myOrders() {
    return this.http.get<{ orders: Order[] }>(`${this.base}/orders`).pipe(map((r) => r.orders));
  }

  get(id: string) {
    return this.http.get<{ order: Order }>(`${this.base}/orders/${id}`).pipe(map((r) => r.order));
  }

  createPaymentIntent(orderId: string) {
    return this.http.post<PaymentIntentResponse>(`${this.base}/payments/${orderId}/intent`, {});
  }

  /** Confirms a Razorpay payment server-side (HMAC-verified) after Checkout.js succeeds. */
  verifyRazorpayPayment(
    orderId: string,
    payload: { razorpayOrderId: string; razorpayPaymentId: string; signature: string },
  ) {
    return this.http
      .post<{ order: Order }>(`${this.base}/payments/${orderId}/razorpay/verify`, payload)
      .pipe(map((r) => r.order));
  }

  /** Demo confirmation used when no payment provider is configured (mock mode). */
  confirmMockPayment(orderId: string) {
    return this.http
      .post<{ order: Order }>(`${this.base}/payments/${orderId}/confirm-mock`, {})
      .pipe(map((r) => r.order));
  }
}
