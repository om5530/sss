import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { environment } from '../../../../environments/environment';

interface FailedEmail { _id: string; subject: string; lastError: string; attempts: number; updatedAt: string }
@Component({
  selector: 'app-admin-notifications', imports: [DatePipe],
    template: `<div class="adm-page">
    <div class="adm-head"><div><h1>Email delivery</h1><p>Notifications are queued before the response and first attempted afterward. A scheduler can process retries while the admin console is offline.</p></div></div>
    @if (error()) { <p class="error-text" role="alert">{{ error() }}</p> }
    <div class="adm-filters"><button class="btn btn--ghost" (click)="load()">Refresh</button><button class="btn btn--primary" [disabled]="busy()" (click)="dispatch()">{{ busy() ? 'Processing…' : 'Process due emails' }}</button></div>
    <div class="adm-card"><p>Pending: {{ counts()['pending'] || 0 }} · Sending: {{ counts()['sending'] || 0 }} · Sent: {{ counts()['sent'] || 0 }} · Failed: {{ counts()['failed'] || 0 }}</p></div>
    <h2>Failed deliveries</h2>
    @for (item of failed(); track item._id) { <article class="adm-card"><strong>{{ item.subject }}</strong><p>{{ item.lastError }}</p><small>{{ item.attempts }} attempts · {{ item.updatedAt | date: 'medium' }}</small></article> }
    @empty { <p>No failed deliveries.</p> }
    <p class="muted">For exhausted or permanent failures, check the provider delivery logs before resending to avoid duplicates.</p>
  </div>`,
})
export class AdminNotifications {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/admin/notifications`;
  protected counts = signal<Record<string, number>>({});
  protected failed = signal<FailedEmail[]>([]);
  protected error = signal('');
  protected busy = signal(false);
  constructor() { this.load(); }
  load() {
    this.error.set('');
    this.http.get<{ counts: Record<string, number>; failed: FailedEmail[] }>(this.base).subscribe({
      next: (res) => { this.counts.set(res.counts); this.failed.set(res.failed); },
      error: () => this.error.set('Could not load email delivery status. Please retry.'),
    });
  }
  dispatch() {
    this.busy.set(true);
    this.http.post(`${this.base}/dispatch`, {}).subscribe({
      next: () => { this.busy.set(false); this.load(); },
      error: () => { this.busy.set(false); this.error.set('Could not process the queue. Please retry.'); },
    });
  }
}
