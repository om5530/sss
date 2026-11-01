export interface SaasCustomer { id: string; displayName: string; email: string; emailVerified: boolean; emailPreviewConfirmedAt?: string | null; }
export interface SaasCustomerCart { items: { productId: string; quantity: number; expectedUnitPricePaise: number }[]; comment: string; }
export interface SaasCustomerSubmit extends SaasCustomerCart { confirmed: true; expectedReservationMinutes?: number; idempotencyKey: string; }
export interface SaasCustomerQuote { reservationMinutes: number; items: { productId: string; name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[]; totalPaise: number; fulfillment: 'pickup'; paymentStatus: 'unpaid'; }
export interface SaasCustomerOrder {
  pickupStatus?: 'pending' | 'ready' | 'collected'; pickupReadyAt?: string | null; pickupCollectedAt?: string | null;
  version: number; reservationStatus?: 'active' | 'cancelled' | 'expired'; reservationExpiresAt?: string | null; reservationClosedAt?: string | null; reservationConfirmedAt?: string | null;
  _id: string; orderNumber: string; items: SaasCustomerQuote['items']; subtotalPaise: number; discountPaise: number; totalPaise: number;
  paymentStatus: 'paid' | 'unpaid'; paymentMethod: 'cash' | 'upi' | 'card' | null; receivedPaise: number; duePaise: number; refundDuePaise: number;
  createdAt: string; updatedAt: string; fulfillment: 'pickup';
}
