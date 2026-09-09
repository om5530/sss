import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';
import { ShopService } from '../../../core/services/shop.service';

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule],
  templateUrl: './admin-settings.html',
})
export class AdminSettings {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private shop = inject(ShopService);
  protected readonly loadFailed = signal(false);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected taxPercent = 5;
  protected deliveryFee = 40;
  protected currency = 'inr';
  protected opensAt = '08:00';
  protected closesAt = '22:00';
  protected contactAddress = '';
  protected contactPhone = '';
  protected contactEmail = '';

  constructor() {
    this.admin.settings().subscribe({
      next: (s) => {
        this.taxPercent = s.taxRate * 100;
        this.deliveryFee = s.deliveryFee;
        this.currency = s.currency;
        this.opensAt = s.opensAt;
        this.closesAt = s.closesAt;
        this.contactAddress = s.contactAddress;
        this.contactPhone = s.contactPhone;
        this.contactEmail = s.contactEmail;
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.loadFailed.set(true); this.toast.error('Could not load store settings. Reload this page to retry.'); },
    });
  }

  save() {
    if (this.saving() || this.loadFailed() || this.loading()) return;
    this.saving.set(true);
    this.admin.updateSettings({
      taxRate: Number(this.taxPercent) / 100,
      deliveryFee: Number(this.deliveryFee),
      currency: this.currency.trim().toLowerCase(),
      opensAt: this.opensAt,
      closesAt: this.closesAt,
      contactAddress: this.contactAddress.trim(),
      contactPhone: this.contactPhone.trim(),
      contactEmail: this.contactEmail.trim(),
    }).subscribe({
      next: (s) => {
        this.taxPercent = s.taxRate * 100;
        this.deliveryFee = s.deliveryFee;
        this.currency = s.currency;
        this.opensAt = s.opensAt;
        this.closesAt = s.closesAt;
        this.saving.set(false);
        this.shop.load();
        this.toast.success('Store settings saved. New prices use them immediately.');
      },
      error: (err) => { this.saving.set(false); this.toast.error(err.error?.details?.[0]?.message || err.error?.message || 'Could not save store settings.'); },
    });
  }
}
