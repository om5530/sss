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
  imports: [BusyButton, RouterLink, DatePipe, DecimalPipe, ConfirmModal, UpiPaymentQr],
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
      return;
    }
    if (!silent) this.loading.set(true);
    this.detailRequest = this.admin.order(this.id()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.order.set(res.order);
        this.payment.set(res.payment);
        this.loading.set(false);
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
