import { environment } from '../../../environments/environment';
import { SaasAccountRecovery } from './saas-account-recovery';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SaasAccountService } from '../../core/services/saas-account.service';
@Component({ selector: 'app-saas-account', imports: [FormsModule, RouterLink, DatePipe, SaasAccountRecovery], templateUrl: './saas-account.html', styleUrls: ['./saas-lab.scss', './saas-account.scss'] })
export class SaasAccount implements OnDestroy {
 protected readonly staging = environment.saasPreview;
 protected readonly api = inject(SaasAccountService); private readonly router = inject(Router); private generation = 0;
 protected readonly recoveryBusy = signal(false); protected readonly busy = signal(false); protected readonly loading = signal(false); protected readonly error = signal(''); protected readonly notice = signal('');
 protected readonly review = signal<'register' | 'password' | null>(null); protected readonly sessions = signal<{ _id: string; createdAt: string; expiresAt: string; current: boolean }[]>([]);
 protected mode: 'login' | 'register' = 'login'; protected form = { email: '', password: '', repeat: '', displayName: '' }; protected passwordForm = { current: '', next: '', repeat: '' };
 constructor() { void this.restore(); }
 ngOnDestroy() { this.generation++; this.clearSecrets(); this.sessions.set([]); }
 private clearSecrets() { this.form.password = ''; this.form.repeat = ''; this.passwordForm = { current: '', next: '', repeat: '' }; }
 protected async restore() { const generation = this.generation; this.loading.set(true); try { await this.api.restore(); } catch (error) { if (!(error instanceof HttpErrorResponse && error.status === 401) && generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.loading.set(false); } }
 protected prepare() { if (this.busy() || this.recoveryBusy() || this.loading()) return; if (this.mode === 'register') { if (this.form.password.length < 12 || this.form.password !== this.form.repeat) { this.error.set('Use matching passwords with at least 12 characters.'); return; } this.review.set('register'); } else void this.authenticate(); }
 protected cancelReview() { if (!this.busy() && !this.recoveryBusy()) { this.review.set(null); this.clearSecrets(); } }
 protected async authenticate() {
  if (this.busy() || this.recoveryBusy() || this.loading() || (this.mode === 'register' && this.review() !== 'register')) return;
  const registering = this.mode === 'register', input = { email: this.form.email, password: this.form.password, ...(registering ? { displayName: this.form.displayName } : {}) }, generation = this.generation;
  this.clearSecrets(); this.busy.set(true); this.error.set('');
  try { const account = await this.api.authenticate(input, registering); if (generation !== this.generation || !account) return; this.review.set(null); this.form = { email: '', password: '', repeat: '', displayName: '' }; await this.router.navigateByUrl('/saas-lab'); }
  catch (error) { if (generation === this.generation) { this.review.set(null); this.failure(error); } } finally { input.password = ''; if (generation === this.generation) this.busy.set(false); }
 }
 protected async logout() { if (this.busy() || this.recoveryBusy()) return; const generation = this.generation; this.busy.set(true); this.error.set(''); try { await this.api.logout(); if (generation === this.generation) { this.sessions.set([]); this.notice.set('Signed out of this workspace session. Pending business-operation recovery was retained.'); } } catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.busy.set(false); } }
 protected reviewPassword() { if (!this.api.state.account() || this.busy()) return; if (!this.passwordForm.current || this.passwordForm.next.length < 12 || this.passwordForm.next !== this.passwordForm.repeat || this.passwordForm.current === this.passwordForm.next) { this.error.set('Choose matching, different new passwords.'); return; } this.error.set(''); this.review.set('password'); }
 protected async changePassword() {
  if (this.review() !== 'password' || this.busy()) return; const input = { ...this.passwordForm }, generation = this.generation; this.clearSecrets(); this.busy.set(true); this.error.set('');
  try { await this.api.changePassword(input.current, input.next); if (generation === this.generation) { this.review.set(null); this.sessions.set([]); this.notice.set('Password changed. Sign in again; all workspace sessions were revoked.'); } } catch (error) { if (generation === this.generation) { this.review.set(null); this.failure(error); } } finally { input.current = ''; input.next = ''; input.repeat = ''; if (generation === this.generation) this.busy.set(false); }
 }
 protected async loadSessions() { if (this.busy() || this.recoveryBusy()) return; const generation = this.generation; this.busy.set(true); this.error.set(''); this.sessions.set([]); try { const result = await firstValueFrom(this.api.sessions()); if (generation === this.generation) this.sessions.set(result.sessions); } catch (error) { if (generation === this.generation) this.failure(error); } finally { if (generation === this.generation) this.busy.set(false); } }
 private failure(error: unknown) { this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : 'The account request was not confirmed. Try signing in before registering or changing credentials again.'); }
}
