export type BakeryRole = 'owner' | 'staff';

export interface Bakery {
  _id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  version: number;
}

export interface BakeryMembership extends Bakery {
  role: BakeryRole;
}

export type BakeryContext = BakeryMembership;

export interface CreateBakeryRequest {
  name: string;
  slug: string;
}

export interface UpdateBakeryRequest {
  name: string;
  expectedVersion: number;
}

export interface BakeryListResponse {
  success: true;
  bakeries: BakeryMembership[];
}

export interface BakeryContextResponse {
  success: true;
  bakery: Bakery;
  role: BakeryRole;
}

export interface CreateBakeryResponse {
  success: true;
  bakery: Bakery;
  role: 'owner';
}

export interface UpdateBakeryResponse {
  success: true;
  bakery: Bakery;
}
