import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, UpiRecipient } from '../../../core/services/admin.service';
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
  protected opensAt = '08:00';
  protected closesAt = '22:00';
  protected contactAddress = '';
  protected contactPhone = '';
  protected contactEmail = '';
  protected upiRecipients: UpiRecipient[] = [];
  protected defaultUpiRecipientId = 'harshita';

  constructor() {
    this.admin.settings().subscribe({
      next: (s) => {
        this.taxPercent = s.taxRate * 100;
        this.deliveryFee = s.deliveryFee;
        this.opensAt = s.opensAt;
        this.closesAt = s.closesAt;
        this.contactAddress = s.contactAddress;
        this.contactPhone = s.contactPhone;
        this.contactEmail = s.contactEmail;
        this.upiRecipients = s.upiRecipients;
        this.defaultUpiRecipientId = s.defaultUpiRecipientId;
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
      currency: 'inr',
      opensAt: this.opensAt,
      closesAt: this.closesAt,
      contactAddress: this.contactAddress.trim(),
      contactPhone: this.contactPhone.trim(),
      contactEmail: this.contactEmail.trim(),
      upiRecipients: this.upiRecipients.map((r) => ({ ...r, upiId: r.upiId.trim(), payeeName: r.payeeName.trim() })),
      defaultUpiRecipientId: this.defaultUpiRecipientId,
    }).subscribe({
      next: (s) => {
        this.taxPercent = s.taxRate * 100;
        this.deliveryFee = s.deliveryFee;
        this.opensAt = s.opensAt;
        this.closesAt = s.closesAt;
        this.saving.set(false);
        this.shop.load();
        this.toast.success('Store settings saved. Contact details, hours and prices are updated.');
      },
      error: (err) => { this.saving.set(false); this.toast.error(err.error?.details?.[0]?.message || err.error?.message || 'Could not save store settings.'); },
    });
  }
}
