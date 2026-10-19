import { ManualPaymentMethod, Order, OrderSource, OrderStatus, OrderType, PaymentStatus } from './order.model';
import { CartQuote } from './cart.model';

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
  productId?: string;
  source?: OrderSource | '';
  eventName?: string;
  status?: OrderStatus | '';
  type?: OrderType | '';
  payment?: PaymentStatus | '';
  amount?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  active?: boolean;
}

export interface ManualOrderPayload {
  upiRecipientId?: string;
  requestKey: string;
  expectedQuote: CartQuote;
  discount: number;
  source: Exclude<OrderSource, 'website'>;
  eventName?: string;
  customer: { name: string; phone: string };
  items: { productId: string; quantity: number }[];
  orderType: OrderType;
  paymentMethod: ManualPaymentMethod;
  paymentStatus: 'pending' | 'paid';
  orderStatus: 'confirmed' | 'completed';
  fulfilAt?: string;
  tableNumber?: string;
  delivery?: Order['delivery'];
  notes: string;
}

export interface EventStockRow {
  eventName: string; productId: string; name: string; prepared: number | null; sold: number; handedOver: number;
  unpaidHandovers: number; refundedHandovers: number; returned: number; wasted: number; reusable: number; remaining: number | null;
  unitCost: number | null; preparedCost: number | null; wastageCost: number | null; reusableValue: number | null; handoverLossCost: number | null;
}

export interface EventSummary {
  eventName: string; planId: string | null; version: number | null; orders: number; paidOrders: number; revenue: number; units: number;
  pendingAmount: number; cash: number; upi: number; card: number; cost: number | null; profit: number | null;
  costEstimated: boolean; lastSaleAt: string | null; openOrders: number;
  status: 'open' | 'closed' | 'unconfigured'; startDate: string; endDate: string; closedAt: string | null;
  rent: number | null; travelCost: number | null; extraCost: number | null; extraCostNote: string;
  netProfit: number | null; preparedUnits: number | null; wastedUnits: number | null; reusableUnits: number | null;
  preparedCost: number | null; wastageCost: number | null; handoverLossCost: number | null; reusableValue: number | null;
  stockReconciled: boolean; changedSinceClose: boolean; revision: string;
}

export interface EventPlanItem {
  productId: string; name: string; prepared: number; wasted: number; reusable: number; returned: number; unitCost: number | null;
  stockOut: number; refundedHandovers: number;
}

export interface EventPlan {
  _id: string; eventName: string; startDate: string; endDate: string; rent: number; travelCost: number; extraCost: number;
  extraCostNote: string; status: 'open' | 'closed'; version: number; closedAt: string | null; items: EventPlanItem[];
}

export interface EventPlanPayload {
  eventName: string; startDate: string; endDate: string; rent: number; travelCost: number; extraCost: number; extraCostNote: string;
  version?: number; items: Pick<EventPlanItem, 'productId' | 'prepared' | 'wasted' | 'reusable' | 'returned'>[];
}

export interface EventPreparationProduct { _id: string; name: string; unitCost: number | null; recipeName: string | null }

export interface EventSalesReport {
  eventNames: string[];
  events: EventSummary[];
  stock: EventStockRow[];
  products: { _id: string; name: string; quantity: number; totalUnits: number | null; cost: number | null;
    totalCost: number | null; wastageCost: number | null; costEstimated: boolean; subtotal: number; profit: number | null }[];
}

export interface CustomerRow {
  active?: boolean;
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
  orderItems?: string;
  quantity?: string;
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
