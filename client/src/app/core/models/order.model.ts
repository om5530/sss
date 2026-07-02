export type OrderType = 'dining' | 'takeaway' | 'delivery';
export type OrderStatus = 'placed' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
/** 'cash' is settled in person (counter / pickup / delivery); 'online' via the gateway. */
export type PaymentMethod = 'online' | 'cash';

export const ORDER_FLOW: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'ready', 'completed'];

export interface OrderItem {
  product: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderPricing {
  subtotal: number;
  discount?: number;
  couponCode?: string;
  tax: number;
  deliveryFee: number;
  total: number;
  currency: string;
}

export interface StatusEvent {
  status: OrderStatus;
  at: string;
  note?: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  items: OrderItem[];
  orderType: OrderType;
  dining?: { tableNumber?: string; customerName?: string };
  takeaway?: { customerName?: string; phone?: string };
  delivery?: { fullAddress?: string; area?: string; city?: string; pincode?: string; landmark?: string };
  pricing: OrderPricing;
  /** Optional: orders created before cash support have no paymentMethod. */
  paymentMethod?: PaymentMethod;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  statusHistory: StatusEvent[];
  createdAt: string;
}

export interface CreateOrderPayload {
  items: { productId: string; quantity: number }[];
  orderType: OrderType;
  paymentMethod?: PaymentMethod;
  couponCode?: string;
  dining?: { tableNumber?: string; customerName?: string };
  takeaway?: { customerName?: string; phone?: string };
  delivery?: { fullAddress?: string; area?: string; city?: string; pincode?: string; landmark?: string };
}
