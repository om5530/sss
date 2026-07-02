export type ProductGroup = 'bakery' | 'savoury';
export type Dietary = 'veg' | 'non-veg' | 'egg';

export interface Product {
  _id: string;
  name: string;
  slug: string;
  group: ProductGroup;
  category: string;
  description: string;
  price: number;
  image: string;
  dietary: Dietary;
  tags: string[];
  available: boolean;
  featured: boolean;
  /** Daily bake count. null/undefined = not tracked; 0 auto-flips available. */
  stockCount?: number | null;
  /** Denormalised review stats (0 when unreviewed). */
  ratingAvg?: number;
  ratingCount?: number;
  /** Soft-deleted from the storefront (admin console only). */
  archived?: boolean;
  updatedAt?: string;
}

export interface Review {
  _id: string;
  authorName: string;
  rating: number;
  text: string;
  createdAt: string;
}

export interface ReviewListResponse {
  reviews: Review[];
  /** True when the signed-in user has a completed order with this product. */
  eligible: boolean;
  myReview: Review | null;
}

/** Shape: { bakery: { Brownies: Product[] }, savoury: { Pizza: Product[] } } */
export type Menu = Record<string, Record<string, Product[]>>;

export interface Category {
  group: ProductGroup;
  category: string;
  count: number;
}
