import { SaasMediaSlot } from '../models/saas-media.model';
import { SaasBillingCheckout, SaasBillingPlan, SaasBillingInput, SaasBillingInvoice } from '../models/saas-billing.model';
import { SaasSubscriptionReport, SaasSubscriptionChange } from '../models/saas-subscription.model';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateSaasProduct, SaasProduct, SaasProductFilters, SaasProductPage, UpdateSaasProduct } from '../models/saas-product.model';
import { SaasItemsPage, SaasMaterial, SaasMaterialInput, SaasRecipe, SaasRecipeDetail, SaasRecipeSave, SaasRevisionInput } from '../models/saas-recipe.model';
import { SaasEvent, SaasEventReport, SaasEventsPage, SaasOrder, SaasOrdersPage, SaasPaymentMethod, SaasSaleInput, SaasOrderCorrection, SaasRefundInput, SaasOrderBalance, SaasPaymentEntry, SaasOrderChange } from '../models/saas-sales.model';
import { SaasPublicMenu, SaasStorefrontFields, SaasStorefrontSettings } from '../models/saas-storefront.model';
import { SaasWasteInput, SaasWasteSave, SaasWasteQuote, SaasWasteEntry } from '../models/saas-waste.model';
import { SaasInventoryInput, SaasInventorySave, SaasInventoryQuote, SaasMaterialStock, SaasMaterialMovement } from '../models/saas-inventory.model';
import { SaasProductionInput, SaasProductionSave, SaasProductionQuote, SaasProductionRun } from '../models/saas-production.model';
import { SaasStockMovement } from '../models/saas-stock.model';
import { SaasUsage } from '../models/saas-usage.model';
import { SaasInvitation, SaasInvitePreview, SaasMember } from '../models/saas-team.model';
import {
  Bakery,
  BakeryContext,
  BakeryContextResponse,
  BakeryListResponse,
  BakeryMembership,
  CreateBakeryRequest,
  CreateBakeryResponse,
  UpdateBakeryRequest,
  UpdateBakeryResponse,
} from '../models/saas.model';

@Injectable({ providedIn: 'root' })
export class SaasService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/saas/bakeries`;

  storefrontLink(bakeryId: string) { return this.http.get<{link:{path:string;url:string;published:boolean;scope:'local-preview'|'staging-preview'}}>(`${this.base}/${encodeURIComponent(bakeryId)}/storefront-link`).pipe(map(r=>r.link)); }
  mediaSlot(bakeryId: string, kind: 'logo' | 'product', targetId: string) { return this.http.get<{ slot: SaasMediaSlot }>(`${this.base}/${encodeURIComponent(bakeryId)}/media/${kind}/${encodeURIComponent(targetId)}`).pipe(map(r => r.slot)); }
  saveMedia(bakeryId: string, kind: 'logo' | 'product', targetId: string, imageBase64: string | null, expectedVersion: number) { return this.http.post<{ slot: SaasMediaSlot }>(`${this.base}/${encodeURIComponent(bakeryId)}/media/${kind}/${encodeURIComponent(targetId)}`, { imageBase64, expectedVersion, confirmed: true }).pipe(map(r => r.slot)); }
  bakeries(): Observable<BakeryMembership[]> {
    return this.http.get<BakeryListResponse>(this.base).pipe(map((response) => response.bakeries));
  }

  createBakery(data: CreateBakeryRequest): Observable<BakeryContext> {
    return this.http.post<CreateBakeryResponse>(this.base, data).pipe(
      map(({ bakery, role }) => ({ ...bakery, role })),
    );
  }

  bakeryContext(bakeryId: string): Observable<BakeryContext> {
    const id = encodeURIComponent(bakeryId);
    return this.http.get<BakeryContextResponse>(`${this.base}/${id}/context`).pipe(
      map(({ bakery, role }) => ({ ...bakery, role })),
    );
  }

  updateBakery(bakeryId: string, data: UpdateBakeryRequest): Observable<Bakery> {
    const id = encodeURIComponent(bakeryId);
    return this.http.patch<UpdateBakeryResponse>(`${this.base}/${id}`, data).pipe(map((response) => response.bakery));
  }

  products(bakeryId: string, filters: SaasProductFilters = {}): Observable<SaasProductPage> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) params[key] = String(value);
    return this.http.get<SaasProductPage & { success: true }>(this.productBase(bakeryId), { params });
  }

  product(bakeryId: string, productId: string): Observable<SaasProduct> {
    return this.http.get<{ success: true; product: SaasProduct }>(`${this.productBase(bakeryId)}/${encodeURIComponent(productId)}`)
      .pipe(map(response => response.product));
  }

  createProduct(bakeryId: string, data: CreateSaasProduct): Observable<SaasProduct> {
    return this.http.post<{ success: true; product: SaasProduct }>(this.productBase(bakeryId), data)
      .pipe(map(response => response.product));
  }

  updateProduct(bakeryId: string, productId: string, data: UpdateSaasProduct): Observable<SaasProduct> {
    return this.http.patch<{ success: true; product: SaasProduct }>(`${this.productBase(bakeryId)}/${encodeURIComponent(productId)}`, data)
      .pipe(map(response => response.product));
  }

  stockHistory(bakeryId: string, productId: string, cursor?: string): Observable<{ entries: SaasStockMovement[]; nextCursor: string | null }> {
    return this.http.get<{ entries: SaasStockMovement[]; nextCursor: string | null }>(`${this.productBase(bakeryId)}/${encodeURIComponent(productId)}/stock-history`, { params: cursor ? { cursor } : {} });
  }
  private productBase(bakeryId: string): string {
    return `${this.base}/${encodeURIComponent(bakeryId)}/products`;
  }

  materials(bakeryId: string, cursor?: string, includeInactive = false): Observable<SaasItemsPage<SaasMaterial>> {
    return this.http.get<SaasItemsPage<SaasMaterial>>(`${this.bakeryBase(bakeryId)}/materials`, { params: { limit: '100', ...(cursor ? { cursor } : {}), ...(includeInactive ? { status: 'all' } : {}) } });
  }
  createMaterial(bakeryId: string, data: SaasMaterialInput): Observable<SaasMaterial> {
    return this.http.post<{ material: SaasMaterial }>(`${this.bakeryBase(bakeryId)}/materials`, data).pipe(map(r => r.material));
  }
  updateMaterial(bakeryId: string, materialId: string, data: Partial<SaasMaterialInput> & { expectedVersion: number }): Observable<SaasMaterial> {
    return this.http.patch<{ material: SaasMaterial }>(`${this.bakeryBase(bakeryId)}/materials/${encodeURIComponent(materialId)}`, data).pipe(map(r => r.material));
  }
  recipes(bakeryId: string, cursor?: string): Observable<SaasItemsPage<SaasRecipe>> {
    return this.http.get<SaasItemsPage<SaasRecipe>>(`${this.bakeryBase(bakeryId)}/recipes`, { params: cursor ? { limit: '100', cursor } : { limit: '100' } });
  }
  recipe(bakeryId: string, recipeId: string, before?: number): Observable<SaasRecipeDetail> {
    return this.http.get<SaasRecipeDetail>(`${this.bakeryBase(bakeryId)}/recipes/${encodeURIComponent(recipeId)}`, { params: before ? { before: String(before), limit: '100' } : { limit: '100' } });
  }
  createRecipe(bakeryId: string, data: SaasRevisionInput & { name: string; category: string }): Observable<SaasRecipeSave> {
    return this.http.post<SaasRecipeSave>(`${this.bakeryBase(bakeryId)}/recipes`, data);
  }
  createRevision(bakeryId: string, recipeId: string, data: SaasRevisionInput & { expectedVersion: number }): Observable<SaasRecipeSave> {
    return this.http.post<SaasRecipeSave>(`${this.bakeryBase(bakeryId)}/recipes/${encodeURIComponent(recipeId)}/revisions`, data);
  }
  mapRecipe(bakeryId: string, productId: string, revisionId: string | null, expectedVersion: number): Observable<Pick<SaasProduct, '_id' | 'recipeId' | 'recipeRevisionId' | 'version'>> {
    return this.http.patch<{ product: Pick<SaasProduct, '_id' | 'recipeId' | 'recipeRevisionId' | 'version'> }>(`${this.productBase(bakeryId)}/${encodeURIComponent(productId)}/recipe-mapping`, { revisionId, expectedVersion }).pipe(map(r => r.product));
  }
  private bakeryBase(bakeryId: string): string { return `${this.base}/${encodeURIComponent(bakeryId)}`; }

  events(bakeryId: string, cursor?: string): Observable<SaasEventsPage> {
    return this.http.get<SaasEventsPage>(`${this.bakeryBase(bakeryId)}/events`, { params: cursor ? { limit: '100', cursor } : { limit: '100' } });
  }
  createEvent(bakeryId: string, data: { name: string; key: string; rentPaise?: number; travelPaise?: number; extraPaise?: number }): Observable<SaasEvent> {
    return this.http.post<{ event: SaasEvent }>(`${this.bakeryBase(bakeryId)}/events`, data).pipe(map(r => r.event));
  }
  closeEvent(bakeryId: string, eventId: string, expectedVersion: number): Observable<SaasEvent> {
    return this.http.post<{ event: SaasEvent }>(`${this.bakeryBase(bakeryId)}/events/${encodeURIComponent(eventId)}/close`, { expectedVersion, confirmed: true }).pipe(map(r => r.event));
  }
  orders(bakeryId: string, filters: { cursor?: string; eventId?: string; paymentStatus?: 'paid' | 'unpaid'; limit?: number } = {}): Observable<SaasOrdersPage> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) params[key] = String(value);
    return this.http.get<SaasOrdersPage>(`${this.bakeryBase(bakeryId)}/orders`, { params });
  }
  createSale(bakeryId: string, input: SaasSaleInput): Observable<{ order: SaasOrder; replayed: boolean }> {
    return this.http.post<{ order: SaasOrder; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/orders`, input);
  }
  updatePickup(bakeryId: string, orderId: string, expectedVersion: number, status: 'ready' | 'collected') { return this.http.post<{ alreadyUpdated: boolean; order: Pick<SaasOrder, '_id' | 'version' | 'pickupStatus' | 'pickupReadyAt' | 'pickupCollectedAt'> }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/pickup-status`, { expectedVersion, status, confirmed: true }); }
  cancelPickup(bakeryId: string, orderId: string, expectedVersion: number, reason: string) { return this.http.post(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/cancel-pickup`, { expectedVersion, reason, confirmed: true }); }
  expireReservations(bakeryId: string) { return this.http.post<{ expiredCount: number; reconciliationCount: number; hasMore: boolean }>(`${this.bakeryBase(bakeryId)}/orders/expire-reservations`, { confirmed: true }); }
  settleSale(bakeryId: string, orderId: string, expectedVersion: number, paymentMethod: SaasPaymentMethod): Observable<SaasOrder> {
    return this.http.post<{ order: SaasOrder }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/settle`, { expectedVersion, paymentMethod, confirmed: true }).pipe(map(r => r.order));
  }
  correctDiscount(bakeryId: string, orderId: string, input: SaasOrderCorrection): Observable<SaasOrderBalance> {
    return this.http.patch<{ order: SaasOrderBalance }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/discount`, input).pipe(map(r => r.order));
  }
  recordRefund(bakeryId: string, orderId: string, input: SaasRefundInput): Observable<{ order: SaasOrderBalance; replayed: boolean }> {
    return this.http.post<{ order: SaasOrderBalance; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/refund`, input);
  }
  paymentHistory(bakeryId: string, orderId: string, cursor?: string): Observable<{ entries: SaasPaymentEntry[]; nextCursor: string | null }> {
    return this.http.get<{ entries: SaasPaymentEntry[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/history/payments`, { params: cursor ? { cursor } : {} });
  }
  correctionHistory(bakeryId: string, orderId: string, cursor?: string): Observable<{ entries: SaasOrderChange[]; nextCursor: string | null }> {
    return this.http.get<{ entries: SaasOrderChange[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/orders/${encodeURIComponent(orderId)}/history/changes`, { params: cursor ? { cursor } : {} });
  }
  eventReport(bakeryId: string, eventId: string): Observable<SaasEventReport> {
    return this.http.get<{ report: SaasEventReport }>(`${this.bakeryBase(bakeryId)}/events/${encodeURIComponent(eventId)}/report`).pipe(map(r => r.report));
  }
  storefrontSettings(bakeryId: string): Observable<SaasStorefrontSettings> {
    return this.http.get<{ settings: SaasStorefrontSettings }>(`${this.bakeryBase(bakeryId)}/storefront-settings`).pipe(map(r => r.settings));
  }
  updateStorefront(bakeryId: string, data: SaasStorefrontFields & { expectedVersion: number }): Observable<SaasStorefrontSettings> {
    return this.http.patch<{ settings: SaasStorefrontSettings }>(`${this.bakeryBase(bakeryId)}/storefront-settings`, data).pipe(map(r => r.settings));
  }
  publicMenu(slug: string, cursor?: string): Observable<SaasPublicMenu> {
    return this.http.get<SaasPublicMenu>(`${environment.apiUrl}/saas/storefront/${encodeURIComponent(slug)}`, { params: cursor ? { cursor } : {} });
  }
  wasteQuote(bakeryId: string, input: SaasWasteInput): Observable<SaasWasteQuote> {
    return this.http.post<{ quote: SaasWasteQuote }>(`${this.bakeryBase(bakeryId)}/waste/quote`, input).pipe(map(r => r.quote));
  }
  recordWaste(bakeryId: string, input: SaasWasteSave): Observable<{ entry: SaasWasteEntry; replayed: boolean }> {
    return this.http.post<{ entry: SaasWasteEntry; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/waste`, input);
  }
  wasteEntries(bakeryId: string, cursor?: string): Observable<{ entries: SaasWasteEntry[]; nextCursor: string | null }> {
    return this.http.get<{ entries: SaasWasteEntry[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/waste`, { params: cursor ? { cursor } : {} });
  }
  inventory(bakeryId: string, cursor?: string): Observable<{ stocks: SaasMaterialStock[]; nextCursor: string | null }> {
    return this.http.get<{ stocks: SaasMaterialStock[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/inventory`, { params: cursor ? { limit: '100', cursor } : { limit: '100' } });
  }
  inventoryQuote(bakeryId: string, input: SaasInventoryInput): Observable<SaasInventoryQuote> {
    return this.http.post<{ quote: SaasInventoryQuote }>(`${this.bakeryBase(bakeryId)}/inventory/quote`, input).pipe(map(r => r.quote));
  }
  recordInventory(bakeryId: string, input: SaasInventorySave): Observable<{ entry: SaasMaterialMovement; replayed: boolean }> {
    return this.http.post<{ entry: SaasMaterialMovement; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/inventory`, input);
  }
  materialHistory(bakeryId: string, materialId: string, cursor?: string): Observable<{ entries: SaasMaterialMovement[]; nextCursor: string | null }> {
    return this.http.get<{ entries: SaasMaterialMovement[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/inventory/${encodeURIComponent(materialId)}/history`, { params: cursor ? { cursor } : {} });
  }
  productionQuote(bakeryId: string, input: SaasProductionInput): Observable<SaasProductionQuote> {
    return this.http.post<{ quote: SaasProductionQuote }>(`${this.bakeryBase(bakeryId)}/production/quote`, input).pipe(map(r => r.quote));
  }
  recordProduction(bakeryId: string, input: SaasProductionSave): Observable<{ run: SaasProductionRun; replayed: boolean }> {
    return this.http.post<{ run: SaasProductionRun; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/production`, input);
  }
  productionRuns(bakeryId: string, cursor?: string): Observable<{ runs: SaasProductionRun[]; nextCursor: string | null }> {
    return this.http.get<{ runs: SaasProductionRun[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/production`, { params: cursor ? { cursor } : {} });
  }
  billing(bakeryId: string) { return this.http.get<{ configured: boolean; mode: 'test'; checkout: SaasBillingCheckout | null }>(`${this.bakeryBase(bakeryId)}/billing`); }
  billingPlans(bakeryId: string) { return this.http.get<{ plans: SaasBillingPlan[] }>(`${this.bakeryBase(bakeryId)}/billing/catalog`); }
  startBilling(bakeryId: string, input: SaasBillingInput) { return this.http.post<{ checkout: SaasBillingCheckout; replayed: boolean }>(`${this.bakeryBase(bakeryId)}/billing/checkout`, { ...input, confirmed: true }); }
  recoverBilling(bakeryId: string, checkoutId: string, providerSubscriptionId: string) { return this.http.post<{ checkout: SaasBillingCheckout }>(`${this.bakeryBase(bakeryId)}/billing/recover`, { checkoutId, providerSubscriptionId, confirmed: true }); }
  synchronizeBilling(bakeryId: string) { return this.http.post<{ checkout: SaasBillingCheckout }>(`${this.bakeryBase(bakeryId)}/billing/synchronize`, {}); }
  cancelBilling(bakeryId: string, expectedVersion: number) { return this.http.post<{ checkout: SaasBillingCheckout }>(`${this.bakeryBase(bakeryId)}/billing/cancel`, { expectedVersion, confirmed: true }); }
  billingInvoices(bakeryId: string, cursor?: string) { return this.http.get<{ invoices: SaasBillingInvoice[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/billing/invoices`, { params: cursor ? { cursor } : {} }); }
  subscription(bakeryId: string) { return this.http.get<SaasSubscriptionReport>(`${this.bakeryBase(bakeryId)}/subscription`); }
  subscriptionHistory(bakeryId: string, cursor?: string) { return this.http.get<{ entries: SaasSubscriptionChange[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/subscription/history`, { params: cursor ? { cursor } : {} }); }
  usage(bakeryId: string): Observable<SaasUsage> {
    return this.http.get<SaasUsage>(`${this.bakeryBase(bakeryId)}/usage`);
  }
  members(bakeryId: string, cursor?: string): Observable<{ members: SaasMember[]; nextCursor: string | null }> {
    return this.http.get<{ members: SaasMember[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/members`, { params: cursor ? { cursor } : {} });
  }
  invitations(bakeryId: string, cursor?: string): Observable<{ invitations: SaasInvitation[]; nextCursor: string | null }> {
    return this.http.get<{ invitations: SaasInvitation[]; nextCursor: string | null }>(`${this.bakeryBase(bakeryId)}/invitations`, { params: cursor ? { cursor } : {} });
  }
  createInvitation(bakeryId: string, expiresInMinutes: number): Observable<{ invitation: SaasInvitation; token: string }> {
    return this.http.post<{ invitation: SaasInvitation; token: string }>(`${this.bakeryBase(bakeryId)}/invitations`, { expiresInMinutes });
  }
  revokeInvitation(bakeryId: string, invitationId: string, expectedVersion: number): Observable<{ invitation: SaasInvitation }> {
    return this.http.post<{ invitation: SaasInvitation }>(`${this.bakeryBase(bakeryId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, { expectedVersion, confirmed: true });
  }
  revokeMember(bakeryId: string, memberId: string, expectedVersion: number): Observable<{ member: Pick<SaasMember, '_id' | 'userId' | 'active' | 'role' | 'version'> }> {
    return this.http.post<{ member: Pick<SaasMember, '_id' | 'userId' | 'active' | 'role' | 'version'> }>(`${this.bakeryBase(bakeryId)}/members/${encodeURIComponent(memberId)}/revoke`, { expectedVersion, confirmed: true });
  }
  inspectInvitation(token: string): Observable<SaasInvitePreview> {
    return this.http.post<SaasInvitePreview>(`${environment.apiUrl}/saas/invitations/inspect`, { token });
  }
  acceptInvitation(token: string): Observable<SaasInvitePreview> {
    return this.http.post<SaasInvitePreview>(`${environment.apiUrl}/saas/invitations/accept`, { token });
  }
}
