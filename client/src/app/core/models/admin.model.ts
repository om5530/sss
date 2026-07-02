import { Order, OrderStatus, OrderType, PaymentStatus } from './order.model';

/** Minimal account info the admin APIs attach to orders/payments. */
export interface CustomerRef {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
}

export interface AdminOrder extends Order {
  user?: CustomerRef | null;
}

export interface DashboardStats {
  today: { orders: number; cancelled: number; revenue: number; avgOrderValue: number };
  activeByStatus: Record<string, number>;
  typeSplit: Record<OrderType, number>;
  unavailable: { _id: string; name: string; category: string }[];
  recentOrders: AdminOrder[];
}

export interface Paged {
  total: number;
  page: number;
  pages: number;
}

export interface OrderListResponse extends Paged {
  orders: AdminOrder[];
}

export interface OrderFilters {
  status?: OrderStatus | '';
  type?: OrderType | '';
  payment?: PaymentStatus | '';
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  active?: boolean;
}

export interface CustomerRow {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
  role: 'customer' | 'admin';
  createdAt: string;
  orderCount: number;
  lastOrderAt?: string;
  totalSpent: number;
}

export interface CustomerListResponse extends Paged {
  customers: CustomerRow[];
}

export interface CustomerDetail {
  customer: CustomerRow & { addresses?: { fullAddress: string; area?: string; city?: string; pincode?: string; isDefault?: boolean }[] };
  orders: AdminOrder[];
  totalSpent: number;
}

export interface AdminPayment {
  _id: string;
  order: {
    _id: string;
    orderNumber: string;
    orderType: OrderType;
    orderStatus: OrderStatus;
    paymentStatus: PaymentStatus;
    pricing: { total: number; currency: string };
    createdAt: string;
  } | null;
  user?: CustomerRef | null;
  provider: string;
  stripePaymentIntentId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  method?: string;
  status: 'requires_payment' | 'processing' | 'succeeded' | 'failed' | 'refunded';
  mock: boolean;
  createdAt: string;
}

export interface PaymentListResponse extends Paged {
  payments: AdminPayment[];
}

export interface SalesReportRow {
  period: string;
  revenue: number;
  orders: number;
  avgOrderValue: number;
}

export interface SalesReport {
  granularity: 'day' | 'week' | 'month';
  rows: SalesReportRow[];
  totals: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    cancelled: number;
    refundedCount: number;
    refundedAmount: number;
  };
}

export interface ProductReport {
  topProducts: { _id: string; name: string; quantity: number; revenue: number; category: string; archived: boolean }[];
  byCategory: { category: string; quantity: number; revenue: number }[];
  byType: { type: OrderType; orders: number; revenue: number }[];
}

export type ContactMessageStatus = 'new' | 'read' | 'closed';

/** A contact-form enquiry, triaged by staff: new → read → closed. */
export interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  message: string;
  status: ContactMessageStatus;
  createdAt: string;
}

export interface MessageListResponse extends Paged {
  messages: ContactMessage[];
  /** Count of status 'new' across all messages (not just this page/filter). */
  newCount: number;
}

export type CouponType = 'percent' | 'flat';

export interface Coupon {
  _id: string;
  code: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  active: boolean;
  expiresAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  createdAt: string;
}

export type CakeRequestStatus = 'new' | 'quoted' | 'accepted' | 'declined' | 'closed';

export interface CakeRequest {
  _id: string;
  user?: CustomerRef | null;
  name: string;
  phone: string;
  email?: string;
  occasion: string;
  servings: number;
  flavour: string;
  messageOnCake?: string;
  dateNeeded: string;
  details?: string;
  referenceImage?: string;
  status: CakeRequestStatus;
  quote: { amount: number | null; note: string };
  createdAt: string;
}

export interface CakeRequestListResponse extends Paged {
  requests: CakeRequest[];
  newCount: number;
}

export interface AuditEntry {
  _id: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface AuditListResponse extends Paged {
  entries: AuditEntry[];
}
