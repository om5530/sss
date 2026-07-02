import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminOrder, AdminPayment } from '../../../core/models/admin.model';
import { ConfirmModal } from '../shared/confirm-modal';
import { NEXT_LABEL, NEXT_STATUS, badgeClass, orderCustomer } from '../shared/admin-ui';

type ModalKind = 'cancel' | 'refund' | 'cash' | null;

@Component({
  selector: 'app-admin-order-detail',
  imports: [RouterLink, DatePipe, DecimalPipe, ConfirmModal],
  templateUrl: './admin-order-detail.html',
})
export class AdminOrderDetail {
  /** Route param, bound via withComponentInputBinding(). */
  readonly id = input.required<string>();

  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly order = signal<AdminOrder | null>(null);
  protected readonly payment = signal<AdminPayment | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly modal = signal<ModalKind>(null);

  protected readonly badgeClass = badgeClass;
  protected readonly orderCustomer = orderCustomer;
  protected readonly nextLabel = NEXT_LABEL;

  constructor() {
    effect(() => {
      this.id();
      this.load();
    });
  }

  protected load() {
    this.loading.set(true);
    this.admin.order(this.id()).subscribe({
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
    return !!o && o.paymentMethod === 'cash' && o.paymentStatus === 'pending' && o.orderStatus !== 'cancelled';
  }

  /** Handed over without the cash being recorded → revenue reports are short. */
  protected cashMissed(): boolean {
    const o = this.order();
    return !!o && o.paymentMethod === 'cash' && o.paymentStatus === 'pending' && o.orderStatus === 'completed';
  }

  advance() {
    const o = this.order();
    const next = this.nextStatus();
    if (!o || !next || this.busy()) return;
    this.busy.set(true);
    this.admin.updateOrderStatus(o._id, next).subscribe({
      next: () => {
        this.busy.set(false);
        this.load();
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

    const done = (message: string) => {
      this.busy.set(false);
      this.modal.set(null);
      this.toast.success(message);
      this.load();
    };
    const fail = (err: { error?: { message?: string } }) => {
      this.busy.set(false);
      this.toast.error(err.error?.message || 'That did not go through — try again.');
    };

    if (kind === 'cancel') {
      this.admin.updateOrderStatus(o._id, 'cancelled', reason).subscribe({
        next: () => done(`${o.orderNumber} cancelled.`),
        error: fail,
      });
    } else if (kind === 'cash') {
      this.admin.settleCash(o._id).subscribe({
        next: () => done(`₹${o.pricing.total.toFixed(2)} cash recorded for ${o.orderNumber}.`),
        error: fail,
      });
    } else {
      this.admin.refundOrder(o._id, reason).subscribe({
        next: () => done(`₹${o.pricing.total.toFixed(2)} refunded for ${o.orderNumber}.`),
        error: fail,
      });
    }
  }
}
