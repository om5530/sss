import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Product } from '../models/product.model';
import { Order, OrderStatus } from '../models/order.model';
import {
  AdminOrder,
  AdminPayment,
  AuditListResponse,
  CakeRequest,
  CakeRequestListResponse,
  CakeRequestStatus,
  ContactMessage,
  ContactMessageStatus,
  Coupon,
  CustomerDetail,
  CustomerListResponse,
  DashboardStats,
  MessageListResponse,
  OrderFilters,
  OrderListResponse,
  PaymentListResponse,
  ProductReport,
  SalesReport,
} from '../models/admin.model';

/** Drops empty values so filters never send `status=` noise. */
function toParams(obj: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/admin`;

  /* ---- Dashboard ---- */

  dashboard() {
    return this.http.get<DashboardStats & { success: boolean }>(`${this.base}/dashboard`);
  }

  /* ---- Orders ---- */

  orders(filters: OrderFilters = {}) {
    return this.http.get<OrderListResponse>(`${this.base}/orders`, { params: toParams(filters) });
  }

  order(id: string) {
    return this.http.get<{ order: AdminOrder; payment: AdminPayment | null }>(`${this.base}/orders/${id}`);
  }

  updateOrderStatus(id: string, status: OrderStatus, note?: string) {
    return this.http
      .patch<{ order: Order }>(`${this.base}/orders/${id}/status`, { status, note })
      .pipe(map((r) => r.order));
  }

  refundOrder(id: string, reason: string) {
    return this.http.post<{ order: Order; payment: AdminPayment }>(`${this.base}/orders/${id}/refund`, { reason });
  }

  /** Records that cash changed hands for a cash order (counter / pickup / delivery). */
  settleCash(id: string) {
    return this.http.post<{ order: Order; payment: AdminPayment }>(`${this.base}/orders/${id}/settle-cash`, {});
  }

  /* ---- Products ---- */

  products(filters: { q?: string; group?: string; category?: string; available?: string; archived?: string } = {}) {
    return this.http
      .get<{ products: Product[] }>(`${this.base}/products`, { params: toParams(filters) })
      .pipe(map((r) => r.products));
  }

  product(id: string) {
    return this.http.get<{ product: Product }>(`${this.base}/products/${id}`).pipe(map((r) => r.product));
  }

  createProduct(data: Partial<Product>) {
    return this.http.post<{ product: Product }>(`${this.base}/products`, data).pipe(map((r) => r.product));
  }

  updateProduct(id: string, data: Partial<Product> & { ifUnmodifiedSince?: string }) {
    return this.http.patch<{ product: Product }>(`${this.base}/products/${id}`, data).pipe(map((r) => r.product));
  }

  archiveProduct(id: string, archived: boolean) {
    return this.http
      .patch<{ product: Product }>(`${this.base}/products/${id}/archive`, { archived })
      .pipe(map((r) => r.product));
  }

  /** Uploads a product photo (≤5 MB, JPEG/PNG/WebP) → public URL. */
  uploadImage(file: File) {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ url: string }>(`${this.base}/uploads`, form).pipe(map((r) => r.url));
  }

  /* ---- Coupons ---- */

  coupons() {
    return this.http.get<{ coupons: Coupon[] }>(`${this.base}/coupons`).pipe(map((r) => r.coupons));
  }

  createCoupon(data: Partial<Coupon>) {
    return this.http.post<{ coupon: Coupon }>(`${this.base}/coupons`, data).pipe(map((r) => r.coupon));
  }

  setCouponActive(id: string, active: boolean) {
    return this.http.patch<{ coupon: Coupon }>(`${this.base}/coupons/${id}`, { active }).pipe(map((r) => r.coupon));
  }

  /* ---- Custom cake requests ---- */

  cakeRequests(filters: { status?: string; page?: number } = {}) {
    return this.http.get<CakeRequestListResponse>(`${this.base}/cake-requests`, { params: toParams(filters) });
  }

  updateCakeRequest(id: string, data: { status?: CakeRequestStatus; quoteAmount?: number | null; quoteNote?: string }) {
    return this.http
      .patch<{ request: CakeRequest }>(`${this.base}/cake-requests/${id}`, data)
      .pipe(map((r) => r.request));
  }

  /* ---- Customers ---- */

  customers(filters: { q?: string; page?: number } = {}) {
    return this.http.get<CustomerListResponse>(`${this.base}/customers`, { params: toParams(filters) });
  }

  customer(id: string) {
    return this.http.get<CustomerDetail>(`${this.base}/customers/${id}`);
  }

  /* ---- Payments ---- */

  payments(filters: { status?: string; page?: number } = {}) {
    return this.http.get<PaymentListResponse>(`${this.base}/payments`, { params: toParams(filters) });
  }

  /* ---- Enquiries ---- */

  messages(filters: { status?: string; page?: number } = {}) {
    return this.http.get<MessageListResponse>(`${this.base}/messages`, { params: toParams(filters) });
  }

  updateMessageStatus(id: string, status: ContactMessageStatus) {
    return this.http
      .patch<{ message: ContactMessage }>(`${this.base}/messages/${id}/status`, { status })
      .pipe(map((r) => r.message));
  }

  /* ---- Reports ---- */

  salesReport(filters: { from?: string; to?: string; granularity?: string } = {}) {
    return this.http.get<SalesReport>(`${this.base}/reports/sales`, { params: toParams(filters) });
  }

  /** Kitchen prep sheet: active orders + today's pre-orders, aggregated per product. */
  prepSheet() {
    return this.http.get<{
      generatedAt: string;
      items: { _id: string; name: string; quantity: number; orders: number }[];
      orders: AdminOrder[];
    }>(`${this.base}/reports/prep`);
  }

  productReport(filters: { from?: string; to?: string } = {}) {
    return this.http.get<ProductReport>(`${this.base}/reports/products`, { params: toParams(filters) });
  }

  /* ---- Audit ---- */

  audit(filters: { entity?: string; page?: number } = {}) {
    return this.http.get<AuditListResponse>(`${this.base}/audit`, { params: toParams(filters) });
  }
}
