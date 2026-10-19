import { FormsModule } from '@angular/forms';
import { BusyButton } from '../shared/busy-button';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UpiPaymentQr } from '../shared/upi-payment-qr';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminOrder, AdminPayment } from '../../../core/models/admin.model';
import { Order } from '../../../core/models/order.model';
import { ConfirmModal } from '../shared/confirm-modal';
import { NEXT_LABEL, NEXT_STATUS, badgeClass, orderSource } from '../shared/admin-ui';

type ModalKind = 'cancel' | 'refund' | 'cash' | 'manual' | null;
type CreatedOrderDetail = { createdOrder: AdminOrder; createdPayment: AdminPayment };

@Component({
  selector: 'app-admin-order-detail',
  imports: [FormsModule, BusyButton, RouterLink, DatePipe, DecimalPipe, ConfirmModal, UpiPaymentQr],
  templateUrl: './admin-order-detail.html',
})
export class AdminOrderDetail {
  /** Route param, bound via withComponentInputBinding(). */
  readonly id = input.required<string>();

  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private detailRequest?: Subscription;
  private createdDetail?: CreatedOrderDetail;
  protected readonly addAnother = this.route.snapshot.queryParamMap.get('next') === '1';
  protected readonly nextSaleParams = { source: this.route.snapshot.queryParamMap.get('source'), eventName: this.route.snapshot.queryParamMap.get('eventName') };

  protected editing = false;
  protected reviewing = false;
  protected draft: { price: number; quantity: number }[] = [];
  protected startEdit() {
    const order = this.order();
    if (!order || this.busy() || order.orderStatus === 'cancelled' || order.paymentStatus === 'refunded') return;
    this.draft = order.items.map(i => ({ price: i.price, quantity: i.quantity }));
    this.editing = true;
  }
  protected validDraft() {
    return this.draft.every(i => Number.isFinite(i.price) && i.price >= 0 && i.price <= 1000000 && Math.abs(i.price * 100 - Math.round(i.price * 100)) < 0.000001 && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 10000);
  }
  protected draftTotal() {
    const p = this.order()!.pricing;
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const sub = round(this.draft.reduce((sum, i) => sum + round(i.price * i.quantity), 0));
    const discount = p.discount || 0;
    return round(sub - discount + round(p.subtotal > discount ? (sub - discount) * p.tax / (p.subtotal - discount) : 0) + (p.deliveryFee || 0));
  }
  protected saveChanges(reason: string) {
    const o = this.order();
    if (!o?.updatedAt || this.busy() || !this.validDraft()) return;
    this.busy.set(true);
    this.admin.modifyOrder(o._id, { items: this.draft, expectedUpdatedAt: o.updatedAt, confirmed: true, reason }).subscribe({
      next: updated => { this.applyOrder(updated); this.busy.set(false); this.editing = false; this.reviewing = false; this.load(true); this.toast.success('Order updated.'); },
      error: err => { this.busy.set(false); this.reviewing = false; this.toast.error(err.error?.message || 'Could not modify order.'); },
    });
  }

  protected readonly order = signal<AdminOrder | null>(null);
  protected readonly payment = signal<AdminPayment | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly modal = signal<ModalKind>(null);

  protected readonly badgeClass = badgeClass;
  protected readonly orderSource = orderSource;
  protected readonly nextLabel = NEXT_LABEL;

  constructor() {
    const navigation = this.router.currentNavigation();
    // Reuse only the fresh save response for this navigation. Refreshes and
    // browser Back still load the current order from the server.
    if (navigation?.trigger === 'imperative' && navigation.previousNavigation) {
      this.createdDetail = navigation.extras.state as CreatedOrderDetail | undefined;
    }
    effect(() => {
      this.id();
      this.load();
    });
  }

  protected load(silent = false) {
    this.detailRequest?.unsubscribe();
    const created = this.createdDetail;
    this.createdDetail = undefined;
    if (created?.createdOrder?._id === this.id() && created.createdPayment) {
      this.order.set(created.createdOrder);
      this.payment.set(created.createdPayment);
      this.loading.set(false);
      if (!silent && this.route.snapshot.queryParamMap.get('edit') === '1') this.startEdit();
      return;
    }
    if (!silent) this.loading.set(true);
    this.detailRequest = this.admin.order(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.order.set(res.order);
        this.payment.set(res.payment);
        this.loading.set(false);
        if (!silent && this.route.snapshot.queryParamMap.get('edit') === '1') this.startEdit();
      },
      error: () => this.loading.set(false),
    });
  }

  protected nextStatus() {
    const o = this.order();
    return o ? NEXT_STATUS[o.orderStatus] : undefined;
  }

  /** Cancelled but the money is still with us → staff must resolve (AS-3.4). */
  protected refundPending(): boolean {
    const o = this.order();
    return !!o && o.orderStatus === 'cancelled' && o.paymentStatus === 'paid';
  }

  /** Cash order still waiting for the money to change hands. */
  protected cashDue(): boolean {
    const o = this.order();
    return !!o && (!o.source || o.source === 'website') && o.paymentMethod === 'cash' && o.paymentStatus === 'pending' && o.orderStatus !== 'cancelled';
  }

  protected manualDue(): boolean {
    const o = this.order();
    return !!o && !!o.source && o.source !== 'website' && o.paymentStatus === 'pending' && o.orderStatus !== 'cancelled';
  }

  /** Handed over without the cash being recorded → revenue reports are short. */
  protected cashMissed(): boolean {
    const o = this.order();
    return !!o && (!o.source || o.source === 'website') && o.paymentMethod === 'cash' && o.paymentStatus === 'pending' && o.orderStatus === 'completed';
  }

  advance() {
    const o = this.order();
    const next = this.nextStatus();
    if (!o || !next || this.busy()) return;
    this.busy.set(true);
    this.admin.updateOrderStatus(o._id, next).subscribe({
      next: (updated) => {
        this.applyOrder(updated);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(err.error?.message || 'Could not update the order.');
      },
    });
  }

  confirmModal(reason: string) {
    const o = this.order();
    const kind = this.modal();
    if (!o || !kind) return;
    this.busy.set(true);

    const done = (message: string, updated: Order, payment?: AdminPayment) => {
      this.applyOrder(updated);
      if (payment) this.payment.set(payment);
      this.busy.set(false);
      this.modal.set(null);
      this.toast.success(message);
    };
    const fail = (err: { error?: { message?: string } }) => {
      this.busy.set(false);
      this.toast.error(err.error?.message || 'That did not go through — try again.');
    };

    if (kind === 'cancel') {
      this.admin.updateOrderStatus(o._id, 'cancelled', reason).subscribe({
        next: (updated) => done(`${o.orderNumber} cancelled.`, updated),
        error: fail,
      });
    } else if (kind === 'manual') {
      this.admin.settleManual(o._id).subscribe({
        next: (result) => done(`₹${o.pricing.total.toFixed(2)} payment recorded for ${o.orderNumber}.`, result.order, result.payment),
        error: fail,
      });
    } else if (kind === 'cash') {
      this.admin.settleCash(o._id).subscribe({
        next: (result) => done(`₹${o.pricing.total.toFixed(2)} cash recorded for ${o.orderNumber}.`, result.order, result.payment),
        error: fail,
      });
    } else {
      this.admin.refundOrder(o._id, reason).subscribe({
        next: (result) => done(`₹${o.pricing.total.toFixed(2)} refunded for ${o.orderNumber}.`, result.order, result.payment),
        error: fail,
      });
    }
  }

  private applyOrder(updated: Order) {
    this.order.update((current) => current ? { ...current, ...updated, user: current.user } : current);
  }
}
