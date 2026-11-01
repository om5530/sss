import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SaasAccountProfile, SaasAccountState } from './saas-account-state.service';
@Injectable({ providedIn: 'root' })
export class SaasAccountService {
 private readonly http = inject(HttpClient); readonly state = inject(SaasAccountState); private generation = 0;
 private readonly base = `${environment.apiUrl}/saas/account`;
 private options() { const account = this.state.account(); return { withCredentials: true, headers: { 'X-Saas-Account': '1', ...(account ? { 'X-Saas-Account-Id': account.id } : {}) } }; }
 async restore() { const generation = ++this.generation; try { const result = await firstValueFrom(this.http.get<{ account: SaasAccountProfile }>(`${this.base}/me`, { withCredentials: true }).pipe(timeout(8000))); if (generation === this.generation) this.state.account.set(result.account); return generation === this.generation ? result.account : null; } catch (error) { if (generation === this.generation && error instanceof HttpErrorResponse && error.status === 401) this.state.account.set(null); throw error; } }
 async authenticate(input: { email: string; password: string; displayName?: string }, registering: boolean) { const generation = ++this.generation; const result = await firstValueFrom(this.http.post<{ account: SaasAccountProfile }>(`${this.base}/${registering ? 'register' : 'login'}`, { ...input, ...(registering ? { confirmed: true } : {}) }, this.options()).pipe(timeout(20000))); if (generation === this.generation) this.state.account.set(result.account); return generation === this.generation ? result.account : null; }
 async logout() { const generation = this.generation; await firstValueFrom(this.http.post(`${this.base}/logout`, {}, this.options()).pipe(timeout(15000))); if (generation === this.generation) { this.generation++; this.state.account.set(null); } }
 async changePassword(currentPassword: string, newPassword: string) { const generation = this.generation; await firstValueFrom(this.http.post(`${this.base}/password/change`, { currentPassword, newPassword, confirmed: true }, this.options()).pipe(timeout(20000))); if (generation === this.generation) { this.generation++; this.state.account.set(null); } }
 requestReset(email: string) { return this.http.post<{ message: string }>(`${this.base}/password-reset/request`, { email }, this.options()).pipe(timeout(20000)); }
 requestVerification() { return this.http.post<{ message: string }>(`${this.base}/email-verification/request`, {}, this.options()).pipe(timeout(20000)); }
 confirmAction(purpose: 'password_reset' | 'email_verify', token: string, newPassword?: string) { return this.http.post<{ message: string }>(`${this.base}/${purpose === 'password_reset' ? 'password-reset' : 'email-verification'}/confirm`, { token, confirmed: true, ...(purpose === 'password_reset' ? { newPassword } : {}) }, this.options()).pipe(timeout(20000)); }
 sessions() { return this.http.get<{ sessions: { _id: string; createdAt: string; expiresAt: string; current: boolean }[] }>(`${this.base}/sessions`, this.options()); }
}
