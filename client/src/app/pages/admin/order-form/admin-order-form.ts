import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService, UpiRecipient } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Product } from '../../../core/models/product.model';
import { CartQuote } from '../../../core/models/cart.model';
import { ManualOrderPayload } from '../../../core/models/admin.model';

interface SaleLine { product: Product; quantity: number }

@Component({
  selector: 'app-admin-order-form',
  imports: [FormsModule, RouterLink, DecimalPipe],
  templateUrl: './admin-order-form.html',
  styleUrl: './admin-order-form.scss',
})
export class AdminOrderForm {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  protected readonly products = signal<Product[]>([]);
  protected readonly events = signal<string[]>([]);
  protected readonly lines = signal<SaleLine[]>([]);
  protected readonly quote = signal<CartQuote | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly pricing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected source: ManualOrderPayload['source'] = 'event';
  protected eventName = '';
  protected customerName = '';
  protected customerPhone = '';
  protected orderType: ManualOrderPayload['orderType'] = 'takeaway';
  protected paymentMethod: ManualOrderPayload['paymentMethod'] = 'upi';
  protected discount = 0;
  protected readonly recipients = signal<UpiRecipient[]>([]);
  protected upiRecipientId = 'harshita';
  protected orderStatus: ManualOrderPayload['orderStatus'] = 'confirmed';
  protected tableNumber = '';
  protected delivery = { fullAddress: '', area: '', city: '', pincode: '', landmark: '' };
  protected notes = '';
  protected showExtraDetails = false;
  protected selectedProduct = '';
  protected saveAnother = false;
  protected readonly retryPending = signal(false);
  private pendingPayload: ManualOrderPayload | null = null;
  private requestKey = crypto.randomUUID();
  private quoteVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saved = false;

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const source = params.get('source');
    if (source === 'phone' || source === 'walk-in' || source === 'event') this.source = source;
    this.eventName = params.get('eventName') || '';
    this.sourceChanged();
    this.loadProducts();
    this.admin.settings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (settings) => { this.recipients.set(settings.upiRecipients); this.upiRecipientId = settings.defaultUpiRecipientId; },
      error: () => this.error.set('Could not load UPI accounts. Refresh before accepting UPI payments.'),
    });
    this.admin.eventSales().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => this.events.set(r.events.map((e) => e.eventName)),
      error: () => {},
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  protected loadProducts() {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.admin.products({ archived: 'false' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (products) => { this.products.set(products); this.loading.set(false); },
      error: () => { this.loadFailed.set(true); this.loading.set(false); },
    });
  }

  protected sourceChanged() {
    this.orderStatus = this.source === 'phone' ? 'confirmed' : 'completed';
  }

  protected availableProducts() {
    return this.products().filter((p) =>
      p.available && !p.archived && p.stockCount !== 0
    );
  }

  protected addItem(productId: string) {
    this.selectedProduct = productId;
    const product = this.products().find((p) => p._id === productId);
    if (!product || !product.available || product.archived || product.stockCount === 0) return;
    const existing = this.lines().find((l) => l.product._id === product._id);
    if (existing) this.setQuantity(product._id, existing.quantity + 1);
    else { this.lines.update((lines) => [{ product, quantity: 1 }, ...lines]); this.reprice(); }
    this.selectedProduct = '';
  }

  protected setQuantity(id: string, quantity: number) {
    this.lines.update((lines) => lines.map((l) => l.product._id === id ? { ...l, quantity } : l));
    this.reprice();
  }

  protected removeItem(id: string) {
    this.lines.update((lines) => lines.filter((l) => l.product._id !== id));
    this.reprice();
  }

  protected discountChanged(value: number): void {
    this.discount = value;
    this.reprice();
  }

  protected orderTypeChanged(value: ManualOrderPayload['orderType']): void {
    this.orderType = value;
    this.reprice();
  }

  protected unitPrice(line: SaleLine) {
    return this.quote()?.items.find((i) => i.product === line.product._id)?.price ?? line.product.price;
  }

  protected reprice() {
    clearTimeout(this.timer);
    const version = ++this.quoteVersion;
    this.quote.set(null);
    this.error.set('');
    this.pricing.set(false);
    if (!this.lines().length) return;
    if (this.lines().some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 10000)) {
      this.error.set('Enter a whole quantity between 1 and 10,000.');
      return;
    }
    const discount = Number(this.discount ?? 0);
    if (!Number.isFinite(discount) || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(discount))) {
      this.error.set('Enter a valid discount in rupees, with up to two decimal places.');
      return;
    }
    this.pricing.set(true);
    this.timer = setTimeout(() => this.admin.quoteManualOrder({ items: this.itemsPayload(), orderType: this.orderType, discount })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (q) => {
          if (version !== this.quoteVersion) return;
          this.pricing.set(false);
          if (Number(q.pricing.discount ?? 0) !== discount) {
            this.error.set('The discount was not included in the total. Refresh and try again.');
            return;
          }
          this.quote.set(q);
        },
        error: (err) => { if (version === this.quoteVersion) { this.error.set(err.error?.message || 'Could not calculate the total. Try again.'); this.pricing.set(false); } },
      }), 200);
  }

  private itemsPayload() {
    return this.lines().map((l) => ({ productId: l.product._id, quantity: l.quantity }));
  }

  protected chooseSaveMode(addAnother: boolean): void {
    // Returning false from a template click assignment cancels the submit action.
    this.saveAnother = addAnother;
  }

  protected save(form: NgForm) {
    if (this.saving()) return;
    if (!this.pendingPayload) {
      form.form.markAllAsTouched();
      if (!form.valid) {
        const labels: Record<string, string> = { eventName: 'Event / Stall name', customerName: 'Customer name', customerPhone: 'Phone',
          address: 'Full delivery address', area: 'Area', city: 'City', pincode: 'Pincode', upiRecipient: 'UPI receiving account', discount: 'Discount' };
        const invalid = Object.entries(form.controls).filter(([, control]) => control.invalid)
          .map(([name]) => labels[name] || (name.startsWith('qty-') ? 'Product quantity' : name));
        this.error.set(`Complete the required fields: ${[...new Set(invalid)].join(', ')}.`);
        return;
      }
      if (!this.quote() || this.pricing()) { this.error.set('Add products and review the total before saving.'); return; }
      if (Number(this.quote()!.pricing.discount ?? 0) !== Number(this.discount ?? 0)) {
        this.reprice();
        this.error.set('Recalculating the discount. Review the updated total before saving.');
        return;
      }
      if (this.paymentMethod === 'upi' && this.quote()!.pricing.total <= 0) { this.error.set('Choose cash for a fully discounted order. No UPI payment is due.'); return; }
      if (this.paymentMethod === 'upi' && !this.recipients().some(r => r.id === this.upiRecipientId && r.upiId)) { this.error.set('Choose a configured UPI account.'); return; }
      this.pendingPayload = {
        requestKey: this.requestKey, expectedQuote: this.quote()!, items: this.itemsPayload(), discount: Number(this.discount ?? 0), source: this.source,
        eventName: this.source === 'event' ? this.eventName.trim() : undefined,
        customer: { name: this.customerName.trim(), phone: this.customerPhone.trim() }, orderType: this.orderType,
        paymentMethod: this.paymentMethod, paymentStatus: this.paymentMethod === 'upi' || this.source === 'phone' ? 'pending' : 'paid', orderStatus: this.orderStatus,
        upiRecipientId: this.paymentMethod === 'upi' ? this.upiRecipientId : undefined,
        tableNumber: this.orderType === 'dining' ? this.tableNumber : undefined,
        delivery: this.orderType === 'delivery' ? { ...this.delivery } : undefined, notes: this.notes.trim(),
      };
    }
    this.saving.set(true);
    this.error.set('');
    this.admin.createManualOrder(this.pendingPayload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (order) => {
        this.saving.set(false);
        this.retryPending.set(false);
        this.pendingPayload = null;
        this.saved = true;
        this.toast.success(`${order.orderNumber} saved.`);
        if (this.saveAnother && order.paymentMethod !== 'upi') {
          this.lines.set([]); this.quote.set(null); this.discount = 0; this.showExtraDetails = false;
          this.customerName = this.customerPhone = this.notes = this.tableNumber = '';
          this.delivery = { fullAddress: '', area: '', city: '', pincode: '', landmark: '' };
          this.requestKey = crypto.randomUUID(); this.saved = false; this.loadProducts();
          if (this.source === 'event' && !this.events().includes(this.eventName.trim())) this.events.update((e) => [...e, this.eventName.trim()]);
        } else this.router.navigate(['/admin/orders', order._id], { queryParams: this.saveAnother ? { next: '1', source: this.source, eventName: this.eventName } : {} });
      },
      error: (err) => {
        this.saving.set(false);
        if (!err.status || err.status >= 500) {
          this.retryPending.set(true);
          this.error.set('The save could not be confirmed. Retry this same sale to check whether it was saved.');
        } else {
          this.pendingPayload = null; this.retryPending.set(false); this.requestKey = crypto.randomUUID();
          if (err.error?.code === 'PRICE_CHANGED') this.quote.set(err.error.quote);
          this.error.set(err.error?.details?.[0]?.message || err.error?.message || 'Could not save the order.');
        }
      },
    });
  }

  canLeave() {
    if (this.saving()) return false;
    return this.saved || (!this.lines().length && !this.customerName && !this.customerPhone && !this.notes) ||
      window.confirm(this.retryPending() ? 'This sale may already be saved. Check Orders before entering it again. Leave this page?' : 'Leave without saving this order?');
  }
}
