export interface SaasProductFields {
  name: string;
  slug: string;
  category: string;
  description: string;
  group: 'bakery' | 'savoury';
  dietary: 'veg' | 'non-veg' | 'egg';
  pricePaise: number;
  stockCount: number | null;
  available: boolean;
  featured: boolean;
  archived: boolean;
}
export interface SaasProduct extends SaasProductFields {
  _id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  recipeId: string | null;
  recipeRevisionId: string | null;
}
export type CreateSaasProduct = Pick<SaasProductFields, 'name' | 'slug' | 'category' | 'pricePaise'> & Partial<SaasProductFields>;
export type UpdateSaasProduct = Partial<SaasProductFields> & { expectedVersion: number; stockCountConfirmed?: true };
export interface SaasProductFilters {
  limit?: number;
  cursor?: string;
  search?: string;
  archived?: 'active' | 'archived' | 'all';
}
export interface SaasProductPage {
  products: SaasProduct[];
  nextCursor: string | null;
}
