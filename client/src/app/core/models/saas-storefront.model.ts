import { SaasPublicImage } from './saas-media.model';
export interface SaasStorefrontFields {
  brandTheme: 'gold' | 'rose' | 'sage'; brandMark: string;
  published: boolean; acceptCustomerOrders: boolean; pickupReservationMinutes: number; tagline: string; description: string; contactPhone: string; contactEmail: string;
  address: string; openingHours: string; showUnavailable: boolean;
}
export interface SaasStorefrontSettings extends SaasStorefrontFields { version: number; }
export interface SaasPublicMenu {
  orderingEnabled: boolean;
  bakery: { name: string; slug: string; currency: string; timezone: string };
  profile: { logo?: SaasPublicImage | null } & Pick<SaasStorefrontFields, 'brandTheme' | 'brandMark' | 'tagline' | 'description' | 'contactPhone' | 'contactEmail' | 'address' | 'openingHours'>;
  products: { image?: SaasPublicImage | null; id: string; name: string; slug: string; category: string; description: string; dietary: string; pricePaise: number; available: boolean }[];
  nextCursor: string | null;
}
