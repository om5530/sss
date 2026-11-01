import { Component, Input, Output, EventEmitter, SimpleChanges, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasAccountService } from '../../core/services/saas-account.service';
@Component({ selector: 'app-saas-account-recovery', imports: [FormsModule], templateUrl: './saas-account-recovery.html', styleUrl: './saas-lab.scss' })
export class SaasAccountRecovery implements OnChanges, OnDestroy {
 @Output() readonly busyChange = new EventEmitter<boolean>();
 @Input() accountId = ''; @Input() accountBusy = false;
 private readonly api = inject(SaasAccountService); private generation = 0;
 protected readonly busy = signal(false); protected readonly error = signal(''); protected readonly notice = signal('');
 protected readonly review = signal<'password_reset' | 'email_verify' | null>(null);
 protected email = ''; protected form = { token: '', password: '', repeat: '' }; protected purpose: 'password_reset' | 'email_verify' = 'password_reset';
 ngOnChanges(changes: SimpleChanges) { if (!changes['accountId']) return; this.generation++; this.clear(); this.email = ''; this.notice.set(''); this.error.set(''); this.setBusy(false); }
 ngOnDestroy() { this.generation++; this.clear(); this.email = ''; this.setBusy(false); }
 private setBusy(value: boolean) { this.busy.set(value); this.busyChange.emit(value); }
 private clear() { this.form = { token: '', password: '', repeat: '' }; this.review.set(null); }
 protected cancel() { if (!this.busy()) this.clear(); }
 protected prepare() {
  if (this.busy() || this.accountBusy) return;
  if (!/^[a-f0-9]{64}$/i.test(this.form.token) || (this.purpose === 'password_reset' && (this.form.password.length < 12 || this.form.password !== this.form.repeat))) { this.error.set('Enter a valid workspace token and matching passwords of at least 12 characters for a reset.'); return; }
  this.error.set(''); this.review.set(this.purpose);
 }
 protected async request(verification = false) {
  if (this.busy() || this.accountBusy || this.review() || (verification && !this.accountId)) return;
  const generation = this.generation; this.setBusy(true); this.error.set(''); this.notice.set('');
  try { const response = await firstValueFrom(verification ? this.api.requestVerification() : this.api.requestReset(this.email)); if (generation === this.generation) this.notice.set(response.message); }
  catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.setBusy(false); }
 }
 protected async confirm() {
  const purpose = this.review(); if (!purpose || this.busy() || this.accountBusy) return;
  const input = { ...this.form }, generation = this.generation; this.clear(); this.setBusy(true); this.error.set(''); this.notice.set('');
  try {
   const response = await firstValueFrom(this.api.confirmAction(purpose, input.token, purpose === 'password_reset' ? input.password : undefined));
   if (generation !== this.generation) return; this.notice.set(response.message);
   // Restore the current cookie. The token may belong to a different account;
   // it must never sign in to that account or clear someone else's session.
   try { await this.api.restore(); } catch (error) { if (!(error instanceof HttpErrorResponse && error.status === 401) && generation === this.generation) this.error.set('Account action completed. Refresh the current workspace session before continuing.'); }
  } catch (error) { if (generation === this.generation) this.failure(error); }
  finally { input.token = ''; input.password = ''; input.repeat = ''; if (generation === this.generation) this.setBusy(false); }
 }
 private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'The workspace request was not confirmed. Try signing in before requesting another reset.'); }
}
