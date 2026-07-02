import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import { ToastService } from '../../../core/services/toast.service';

interface TableQr {
  table: number;
  dataUrl: string;
  url: string;
}

/**
 * Printable QR codes for dine-in tables: scanning opens /menu?table=N, which
 * preselects dine-in with the table number at checkout.
 */
@Component({
  selector: 'app-admin-qr',
  imports: [FormsModule],
  templateUrl: './admin-qr.html',
})
export class AdminQr {
  private toast = inject(ToastService);

  protected count = 8;
  protected readonly codes = signal<TableQr[]>([]);
  protected readonly generating = signal(false);

  constructor() {
    void this.generate();
  }

  async generate() {
    const n = Math.min(60, Math.max(1, Math.floor(Number(this.count) || 0)));
    this.count = n;
    this.generating.set(true);
    try {
      const origin = location.origin;
      const codes: TableQr[] = [];
      for (let table = 1; table <= n; table += 1) {
        const url = `${origin}/menu?table=${table}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 480,
          margin: 1,
          color: { dark: '#2b1a10', light: '#ffffff' },
        });
        codes.push({ table, dataUrl, url });
      }
      this.codes.set(codes);
    } catch {
      this.toast.error('Could not generate the QR codes.');
    } finally {
      this.generating.set(false);
    }
  }

  print() {
    window.print();
  }
}
