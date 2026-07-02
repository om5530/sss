import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { OrderService } from './order.service';

/** What Checkout.js hands back on a successful payment. */
interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount?: number;
  currency?: string;
  name: string;
  description?: string;
  prefill?: { name?: string; contact?: string; email?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (response: RazorpaySuccess) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void };
  }
}

/**
 * 'paid'    — money confirmed server-side.
 * 'pending' — order saved but not paid (popup dismissed / provider unavailable);
 *             the customer can retry from the order page or pay on hand-over.
 * 'failed'  — the gateway said paid but our verification rejected it.
 */
export type PayResult = 'paid' | 'pending' | 'failed';

export interface PayPrefill {
  name?: string;
  contact?: string;
  email?: string;
}

/**
 * One place that knows how to take money for an order: asks the server which
 * rail is live (Razorpay → Stripe → mock) and drives it. Used by checkout and
 * by the "Complete payment" retry on the order pages.
 */
@Injectable({ providedIn: 'root' })
export class PaymentFlowService {
  private orders = inject(OrderService);
  private scriptPromise?: Promise<boolean>;

  async payOnline(orderId: string, prefill?: PayPrefill): Promise<PayResult> {
    const intent = await firstValueFrom(this.orders.createPaymentIntent(orderId));

    if (intent.provider === 'razorpay') return this.payWithRazorpay(orderId, intent, prefill);

    if (intent.mock) {
      // No provider keys — dev demo confirms server-side so the flow completes.
      await firstValueFrom(this.orders.confirmMockPayment(orderId));
      return 'paid';
    }

    // Stripe keys present but no client capture is built for Stripe — the
    // order stays payable (Razorpay is the supported live rail).
    return 'pending';
  }

  private async payWithRazorpay(
    orderId: string,
    intent: { keyId?: string; razorpayOrderId?: string; amount?: number; currency?: string; orderNumber?: string },
    prefill?: PayPrefill,
  ): Promise<PayResult> {
    const loaded = await this.loadCheckoutScript();
    if (!loaded || !window.Razorpay) {
      // CDN blocked/offline — the order exists; let the customer retry later.
      this.scriptPromise = undefined;
      return 'pending';
    }

    return new Promise<PayResult>((resolve) => {
      let settled = false;
      const done = (result: PayResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      new window.Razorpay!({
        key: intent.keyId!,
        order_id: intent.razorpayOrderId!,
        amount: intent.amount,
        currency: intent.currency,
        name: 'Sweet Savory Savor',
        description: intent.orderNumber ? `Order ${intent.orderNumber}` : 'Bakery order',
        prefill,
        theme: { color: '#d94f78' },
        modal: { ondismiss: () => done('pending') },
        handler: (response) => {
          // The gateway approved — but only the server's HMAC check makes it real.
          this.orders
            .verifyRazorpayPayment(orderId, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            })
            .subscribe({
              next: () => done('paid'),
              // Verification failed here, but the webhook may still settle it.
              error: () => done('failed'),
            });
        },
      }).open();
    });
  }

  /** Loads Checkout.js once; concurrent callers share the same promise. */
  private loadCheckoutScript(): Promise<boolean> {
    this.scriptPromise ??= new Promise<boolean>((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }
}
