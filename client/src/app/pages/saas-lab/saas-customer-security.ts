import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { SaasCustomerService } from '../../core/services/saas-customer.service';
import { SaasCustomer } from '../../core/models/saas-customer.model';
type Mode = 'change' | 'request-reset' | 'reset' | 'request-verify' | 'verify';
@Component({ selector: 'app-saas-customer-security', imports: [FormsModule], templateUrl: './saas-customer-security.html', styleUrl: './saas-lab.scss' })
export class SaasCustomerSecurity implements OnChanges, OnDestroy {
  @Input({ required: true }) slug!: string;
  @Input({ required: true }) customer!: SaasCustomer | null;
  @Input() disabled = false;
  @Output() accountChanged = new EventEmitter<string>();
  @Output() securityBusy = new EventEmitter<boolean>();
  private readonly api = inject(SaasCustomerService);
  private generation = 0;
  private context = '';
  protected readonly mode = signal<Mode | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly changeReview = signal(false);
  protected form = { email: '', token: '', currentPassword: '', newPassword: '', repeatPassword: '' };
  ngOnChanges() {
    const context = `${this.slug}:${this.customer?.id || ''}`; if (context === this.context) return;
    this.context = context; this.generation++; this.clear(); this.mode.set(null); this.error.set(''); this.notice.set(''); this.busy.set(false);
  }
  ngOnDestroy() { this.generation++; this.clear(); }
  private clear() { this.form = { email: '', token: '', currentPassword: '', newPassword: '', repeatPassword: '' }; this.changeReview.set(false); }
  protected open(mode: Mode | null) { if (this.busy() || this.disabled) return; this.clear(); this.mode.set(mode); this.error.set(''); this.notice.set(''); }
  protected reviewPassword() {
    if (this.busy() || this.disabled || !this.customer || this.mode() !== 'change') return;
    if (!this.form.currentPassword || this.form.newPassword.length < 12 || this.form.newPassword !== this.form.repeatPassword || this.form.currentPassword === this.form.newPassword) { this.error.set('Check your current password and choose a different matching new password.'); return; }
    this.error.set(''); this.changeReview.set(true);
  }
  protected async submit() {
    const mode = this.mode(), customer = this.customer;
    if (!mode || this.busy() || this.disabled || (['change', 'request-verify'].includes(mode) && !customer) || (mode === 'change' && !this.changeReview())) return;
    if (['reset', 'change'].includes(mode) && (this.form.newPassword.length < 12 || this.form.newPassword.length > 128 || this.form.newPassword !== this.form.repeatPassword)) { this.error.set('Use matching passwords with 12–128 characters.'); return; }
    const generation = this.generation, input = { ...this.form }; this.clear(); this.busy.set(true); this.securityBusy.emit(true); this.error.set(''); this.notice.set('');
    try {
      const request = mode === 'request-reset' ? this.api.requestReset(this.slug, input.email)
        : mode === 'reset' ? this.api.resetPassword(this.slug, input.token.trim(), input.newPassword)
        : mode === 'request-verify' ? this.api.requestVerification(this.slug, customer!.id)
        : mode === 'verify' ? this.api.confirmVerification(this.slug, input.token.trim())
        : this.api.changePassword(this.slug, customer!.id, input.currentPassword, input.newPassword);
      const response = await firstValueFrom(request.pipe(timeout(20000)));
      if (generation !== this.generation) return;
      this.notice.set(response.message); this.mode.set(null);
      if (['change', 'reset', 'verify'].includes(mode)) this.accountChanged.emit(response.message);
    } catch (error) {
      if (generation !== this.generation) return;
      this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'Request was not confirmed. For a password update, try signing in before requesting another token.');
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.error?.details?.code === 'CUSTOMER_SESSION_CHANGED')) this.accountChanged.emit('Sign in again to refresh this account. Pending pickup order recovery was retained.');
    } finally { input.token = ''; input.currentPassword = ''; input.newPassword = ''; input.repeatPassword = ''; if (generation === this.generation) { this.busy.set(false); this.securityBusy.emit(false); } }
  }
}
