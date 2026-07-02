import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { CartService } from '../../core/services/cart.service';
import { AuthService } from '../../core/services/auth.service';
import { OrderService } from '../../core/services/order.service';
import { PaymentFlowService } from '../../core/services/payment-flow.service';
import { ToastService } from '../../core/services/toast.service';
import { CartPricing } from '../../core/models/cart.model';
import { Address } from '../../core/models/user.model';
import { CreateOrderPayload, OrderType, PaymentMethod } from '../../core/models/order.model';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';

@Component({
  selector: 'app-checkout',
  imports: [FormsModule, RouterLink, RevealOnScroll],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class Checkout {
  protected cart = inject(CartService);
  protected auth = inject(AuthService);
  private orders = inject(OrderService);
  private payments = inject(PaymentFlowService);
  private router = inject(Router);
  private toast = inject(ToastService);

  protected readonly orderType = signal<OrderType>('takeaway');
  protected readonly paymentMethod = signal<PaymentMethod>('cash');
  protected readonly pricing = signal<CartPricing | null>(null);
  protected readonly placing = signal(false);
  protected readonly errorMsg = signal('');
  /** Coupon state: what's typed, what's actually applied, and why it failed. */
  protected couponInput = '';
  protected readonly appliedCoupon = signal('');
  protected readonly couponError = signal('');
  protected readonly applyingCoupon = signal(false);

  protected readonly types: { key: OrderType; label: string; hint: string }[] = [
    { key: 'dining', label: 'Dine-in', hint: 'Eat in the café' },
    { key: 'takeaway', label: 'Takeaway', hint: 'Collect your order' },
    { key: 'delivery', label: 'Delivery', hint: 'To your door' },
  ];

  /** How the cash option reads for the chosen fulfilment. */
  protected readonly cashLabel = computed(() => {
    const type = this.orderType();
    if (type === 'dining') return { label: 'Pay at counter', hint: 'Cash or UPI when you visit' };
    if (type === 'delivery') return { label: 'Cash on delivery', hint: 'Pay the rider at your door' };
    return { label: 'Pay at pickup', hint: 'Cash or UPI at the counter' };
  });

  protected form = {
    dining: { tableNumber: '', customerName: '' },
    takeaway: { customerName: '', phone: '' },
    delivery: { fullAddress: '', area: '', city: '', pincode: '', landmark: '' },
  };

  protected readonly savedAddresses = computed<Address[]>(() => this.auth.user()?.addresses ?? []);

  // Delivery requires an account; dine-in and takeaway allow guest checkout.
  protected readonly needsLogin = computed(
    () => this.orderType() === 'delivery' && !this.auth.isAuthenticated(),
  );

  constructor() {
    const user = this.auth.user();
    if (user) {
      this.form.dining.customerName = user.name ?? '';
      this.form.takeaway.customerName = user.name ?? '';
      this.form.takeaway.phone = user.phone ?? '';
      const def = (user.addresses ?? []).find((a) => a.isDefault) ?? user.addresses?.[0];
      if (def) this.applyAddress(def);
    }

    // Re-price whenever the order type, cart, or applied coupon changes.
    effect(() => {
      const type = this.orderType();
      const coupon = this.appliedCoupon();
      if (this.cart.isEmpty()) {
        this.pricing.set(null);
        return;
      }
      this.cart.price(type, coupon || undefined).subscribe({
        next: (res) => this.pricing.set(res.pricing),
        error: (err: HttpErrorResponse) => {
          if (coupon) {
            // Coupon stopped applying (e.g. cart dropped below its minimum) —
            // drop it and let the effect re-run without it.
            this.couponError.set(err.error?.message || 'That coupon no longer applies.');
            this.appliedCoupon.set('');
          } else {
            this.pricing.set(null);
          }
        },
      });
    });
  }

  applyCoupon() {
    const code = this.couponInput.trim().toUpperCase();
    if (!code || this.applyingCoupon()) return;
    this.applyingCoupon.set(true);
    this.couponError.set('');
    this.cart.price(this.orderType(), code).subscribe({
      next: (res) => {
        this.applyingCoupon.set(false);
        this.pricing.set(res.pricing);
        this.appliedCoupon.set(code);
        this.couponInput = '';
      },
      error: (err: HttpErrorResponse) => {
        this.applyingCoupon.set(false);
        this.couponError.set(err.error?.message || 'That coupon code isn’t valid.');
      },
    });
  }

  removeCoupon() {
    this.appliedCoupon.set('');
    this.couponError.set('');
  }

  setType(type: OrderType) {
    this.orderType.set(type);
    this.errorMsg.set('');
  }

  applyAddress(addr: Address) {
    this.form.delivery = {
      fullAddress: addr.fullAddress ?? '',
      area: addr.area ?? '',
      city: addr.city ?? '',
      pincode: addr.pincode ?? '',
      landmark: addr.landmark ?? '',
    };
  }

  private validate(): string | null {
    const type = this.orderType();
    if (type === 'delivery' && !this.auth.isAuthenticated()) {
      return 'Please sign in to place a delivery order.';
    }
    if (type === 'takeaway') {
      if (!this.form.takeaway.customerName.trim() || !this.form.takeaway.phone.trim()) {
        return 'Please provide your name and phone number for takeaway.';
      }
    }
    if (type === 'delivery') {
      const d = this.form.delivery;
      if (!d.fullAddress.trim() || !d.city.trim() || !d.pincode.trim()) {
        return 'Please provide the full address, city and pincode for delivery.';
      }
    }
    return null;
  }

  placeOrder() {
    if (this.cart.isEmpty()) {
      this.toast.error('Your cart is empty.');
      return;
    }
    const validationError = this.validate();
    if (validationError) {
      this.errorMsg.set(validationError);
      return;
    }
    this.errorMsg.set('');
    this.placing.set(true);

    const type = this.orderType();
    // Snapshot once — the payload sent and the follow-up decision must agree
    // even if the user toggles the control while the request is in flight.
    const method = this.paymentMethod();
    const payload: CreateOrderPayload = {
      items: this.cart.payload(),
      orderType: type,
      paymentMethod: method,
      couponCode: this.appliedCoupon() || undefined,
    };
    if (type === 'dining') payload.dining = this.form.dining;
    if (type === 'takeaway') payload.takeaway = this.form.takeaway;
    if (type === 'delivery') payload.delivery = this.form.delivery;

    this.orders.create(payload).subscribe({
      next: (order) => {
        // Cash settles in person — no payment step; staff mark it paid on hand-over.
        if (method === 'cash') this.finish(order._id);
        else this.pay(order._id);
      },
      error: (err: HttpErrorResponse) => {
        this.placing.set(false);
        this.errorMsg.set(err.error?.message || 'Could not place your order. Please try again.');
      },
    });
  }

  private pay(orderId: string) {
    const type = this.orderType();
    const user = this.auth.user();
    const prefill = {
      name:
        (type === 'takeaway' ? this.form.takeaway.customerName : this.form.dining.customerName) ||
        user?.name ||
        undefined,
      contact: (type === 'takeaway' ? this.form.takeaway.phone : user?.phone) || undefined,
      email: user?.email || undefined,
    };

    this.payments
      .payOnline(orderId, prefill)
      .then((result) => {
        if (result === 'pending') {
          this.toast.info('Payment not completed — you can finish it any time from your order page.');
        } else if (result === 'failed') {
          this.toast.error('We could not verify that payment — if you were charged, it will reconcile shortly.');
        }
        this.finish(orderId);
      })
      .catch(() => {
        // Order exists but payment couldn't start; still show its confirmation.
        this.finish(orderId);
      });
  }

  private finish(orderId: string) {
    this.placing.set(false);
    this.cart.clear();
    this.router.navigate(['/order-success', orderId]);
  }
}
