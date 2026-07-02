export interface CartItem {
  productId: string;
  slug: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
}

export interface CartPricing {
  subtotal: number;
  /** Coupon discount off the subtotal (0 when no code applied). */
  discount?: number;
  couponCode?: string;
  tax: number;
  deliveryFee: number;
  total: number;
  currency: string;
  taxRate: number;
}
