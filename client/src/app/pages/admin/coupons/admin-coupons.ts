import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { Coupon, CouponType } from '../../../core/models/admin.model';

@Component({
  selector: 'app-admin-coupons',
  imports: [FormsModule, DatePipe, DecimalPipe],
  templateUrl: './admin-coupons.html',
})
export class AdminCoupons {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  protected readonly coupons = signal<Coupon[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly showForm = signal(false);

  // Create form
  protected code = '';
  protected type: CouponType = 'percent';
  protected value: number | null = null;
  protected minSubtotal: number | null = null;
  protected maxDiscount: number | null = null;
  protected expiresAt = '';
  protected usageLimit: number | null = null;

  constructor() {
    this.fetch();
  }

  protected fetch() {
    this.loading.set(true);
    this.admin.coupons().subscribe({
      next: (coupons) => {
        this.coupons.set(coupons);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected discountLabel(c: Coupon): string {
    const base = c.type === 'percent' ? `${c.value}% off` : `₹${c.value} off`;
    return c.maxDiscount ? `${base} (max ₹${c.maxDiscount})` : base;
  }

  protected expired(c: Coupon): boolean {
    return !!c.expiresAt && new Date(c.expiresAt) < new Date();
  }

  protected create() {
    if (this.saving()) return;
    if (!this.code.trim() || !this.value) {
      this.toast.error('A code and a discount value are required.');
      return;
    }
    this.saving.set(true);
    this.admin
      .createCoupon({
        code: this.code.trim().toUpperCase(),
        type: this.type,
        value: Number(this.value),
        minSubtotal: this.minSubtotal ? Number(this.minSubtotal) : 0,
        maxDiscount: this.maxDiscount ? Number(this.maxDiscount) : null,
        expiresAt: this.expiresAt || null,
        usageLimit: this.usageLimit ? Number(this.usageLimit) : null,
      })
      .subscribe({
        next: (coupon) => {
          this.saving.set(false);
          this.showForm.set(false);
          this.code = '';
          this.value = this.minSubtotal = this.maxDiscount = this.usageLimit = null;
          this.expiresAt = '';
          this.toast.success(`${coupon.code} is live — share it away.`);
          this.fetch();
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(err.error?.details?.[0]?.message || err.error?.message || 'Could not create the coupon.');
        },
      });
  }

  protected toggle(c: Coupon) {
    if (this.busyId()) return;
    this.busyId.set(c._id);
    this.admin.setCouponActive(c._id, !c.active).subscribe({
      next: () => {
        this.busyId.set(null);
        this.fetch();
      },
      error: (err) => {
        this.busyId.set(null);
        this.toast.error(err.error?.message || 'Could not update the coupon.');
      },
    });
  }
}
