export type SaasPaymentMethod = 'cash' | 'upi' | 'card';
export interface SaasEvent {
  _id: string; name: string; key: string; status: 'open' | 'closed'; version: number;
  rentPaise?: number; travelPaise?: number; extraPaise?: number;
}
export interface SaasSaleInput {
  eventId: string | null;
  items: { productId: string; quantity: number; expectedUnitPricePaise: number }[];
  discountPaise: number; paymentStatus: 'paid' | 'unpaid'; paymentMethod: SaasPaymentMethod | null;
  comment: string; idempotencyKey: string;
}
export interface SaasOrder {
  pickupStatus?: 'pending' | 'ready' | 'collected'; pickupReadyAt?: string | null; pickupCollectedAt?: string | null;
  reservationStatus?: 'active' | 'cancelled' | 'expired'; reservationExpiresAt?: string | null; reservationClosedAt?: string | null; reservationConfirmedAt?: string | null;
  reservationReturns?: { productId: string; quantity: number; status: string }[];
  source?: 'counter' | 'storefront'; fulfillment?: 'pickup';
  _id: string; eventId: string | null; orderNumber: string;
  items: { productId: string; name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number; stockClaimed: boolean }[];
  subtotalPaise: number; discountPaise: number; totalPaise: number; receivedPaise: number; duePaise: number; refundDuePaise: number; paymentStatus: 'paid' | 'unpaid';
  paymentMethod: SaasPaymentMethod | null; comment: string; version: number; createdAt: string; updatedAt: string;
}
export interface SaasOrdersPage { orders: SaasOrder[]; nextCursor: string | null; }
export interface SaasEventsPage { events: SaasEvent[]; nextCursor: string | null; }
export interface SaasEventReport {
  recordedWasteUnits: number; unknownWasteLines: number; knownWasteCostPaise: string;
  event: SaasEvent; paidOrders: number; unpaidOrders: number; paidUnits: number; unknownCostLines: number;
  paidSalesPaise: string; receivedMoneyPaise: string; refundDuePaise: string; knownSoldCostPaise: string; outstandingPaise: string; expensesPaise: string; recordedProfitPaise: string | null;
  includesProductionWaste: false;
}

export interface SaasOrderCorrection {
  expectedVersion: number; discountPaise: number; comment: string; reason: string; confirmed: true;
}
export interface SaasRefundInput {
  expectedVersion: number; expectedRefundPaise: number; paymentMethod: SaasPaymentMethod;
  reason: string; confirmed: true; idempotencyKey: string;
}
export type SaasOrderBalance = Pick<SaasOrder, '_id' | 'discountPaise' | 'totalPaise' | 'receivedPaise' | 'duePaise' | 'refundDuePaise' | 'paymentStatus' | 'version'>;
export interface SaasPaymentEntry {
  _id: string; kind: 'receipt' | 'refund' | 'baseline'; amountPaise: number; paymentMethod: SaasPaymentMethod | null; reason: string; createdAt: string;
}
export interface SaasOrderChange {
  _id: string; fromVersion: number; toVersion: number; beforeDiscountPaise: number; afterDiscountPaise: number;
  beforeTotalPaise: number; afterTotalPaise: number; reason: string; createdAt: string;
}
