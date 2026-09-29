import { Component, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { toDataURL } from 'qrcode';
import { AdminService, UpiPaymentRequest } from '../../../core/services/admin.service';

@Component({
  selector: 'adm-upi-payment-qr',
  imports: [DecimalPipe],
  template: `
    <section class="adm-card" style="text-align: center">
      <h3>Scan to pay</h3>
      @if (error()) { <p role="alert">{{ error() }}</p><button type="button" class="btn btn--ghost" (click)="retry.update(increment)">Retry</button> }
      @else if (qr(); as image) {
        @if (payment(); as p) {
          <p style="font-size: 2rem; font-weight: 800; margin: .5rem">₹{{ p.amount | number: '1.2-2' }}</p>
          @if (p.discount > 0) { <p>Discount applied: −₹{{ p.discount | number: '1.2-2' }}</p> }
          <p>{{ p.payeeName }}</p>
          <img [src]="image" width="320" height="320" style="display: block; margin-inline: auto; max-width: 100%; height: auto" [alt]="'UPI payment QR for ' + p.orderNumber" />
          <p style="overflow-wrap: anywhere">{{ p.upiId }}</p>
          <p class="muted">{{ p.orderNumber }} · INR</p>
          <a class="btn btn--ghost btn--sm" [href]="image" [download]="p.orderNumber + '-upi.png'">Download QR</a>
          <p class="muted">Check this account for the full payment, then select “Mark payment received”.</p>
        }
      } @else { <p role="status">Preparing payment QR…</p> }
    </section>
  `,
})
export class UpiPaymentQr {
  readonly orderId = input.required<string>();
  private admin = inject(AdminService);
  protected readonly payment = signal<UpiPaymentRequest | null>(null);
  protected readonly qr = signal('');
  protected readonly error = signal('');
  protected readonly retry = signal(0);
  protected readonly increment = (n: number) => n + 1;

  constructor() {
    effect((cleanup) => {
      this.retry();
      this.qr.set(''); this.error.set(''); this.payment.set(null);
      let active = true;
      const subscription = this.admin.orderUpiQr(this.orderId()).subscribe({
        next: async (payment) => {
          try {
            const qr = await toDataURL(payment.uri, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
            if (active) { this.payment.set(payment); this.qr.set(qr); }
          } catch { if (active) this.error.set('Could not generate the QR. Please retry.'); }
        },
        error: (err) => this.error.set(err.error?.message || 'Could not load payment details. Please retry.'),
      });
      cleanup(() => { active = false; subscription.unsubscribe(); });
    });
  }
}
