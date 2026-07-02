import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Address, ApiResponse, AuthResponse, OtpRequestResponse, User } from '../models/user.model';

const TOKEN_KEY = 'bc_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  readonly user = signal<User | null>(null);
  readonly isAuthenticated = computed(() => this.user() !== null);

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Called by APP_INITIALIZER — resolves the current user from a stored token. */
  restoreSession(): Promise<void> {
    if (!this.token) return Promise.resolve();
    return firstValueFrom(this.http.get<{ user: User }>(`${this.base}/auth/me`))
      .then((res) => this.user.set(res.user))
      .catch(() => this.clearSession());
  }

  requestOtp(phone: string) {
    return this.http.post<OtpRequestResponse>(`${this.base}/auth/otp/request`, { phone });
  }

  verifyOtp(phone: string, code: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/auth/otp/verify`, { phone, code })
      .pipe(tap((res) => this.setSession(res)));
  }

  googleLogin(idToken: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/auth/google`, { idToken })
      .pipe(tap((res) => this.setSession(res)));
  }

  /** Exchanges a Firebase phone-auth ID token for our own session. */
  firebasePhoneLogin(idToken: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/auth/firebase-phone`, { idToken })
      .pipe(tap((res) => this.setSession(res)));
  }

  updateProfile(data: { name?: string; email?: string }) {
    return this.http
      .patch<{ user: User }>(`${this.base}/auth/me`, data)
      .pipe(tap((res) => this.user.set(res.user)));
  }

  addAddress(address: Address) {
    return this.http
      .post<{ addresses: Address[] }>(`${this.base}/auth/addresses`, address)
      .pipe(tap((res) => this.patchAddresses(res.addresses)));
  }

  updateAddress(id: string, address: Partial<Address>) {
    return this.http
      .patch<{ addresses: Address[] }>(`${this.base}/auth/addresses/${id}`, address)
      .pipe(tap((res) => this.patchAddresses(res.addresses)));
  }

  deleteAddress(id: string) {
    return this.http
      .delete<{ addresses: Address[] }>(`${this.base}/auth/addresses/${id}`)
      .pipe(tap((res) => this.patchAddresses(res.addresses)));
  }

  logout() {
    return firstValueFrom(this.http.post<ApiResponse>(`${this.base}/auth/logout`, {}))
      .catch(() => undefined)
      .finally(() => this.clearSession());
  }

  private setSession(res: AuthResponse) {
    localStorage.setItem(TOKEN_KEY, res.token);
    this.user.set(res.user);
  }

  private patchAddresses(addresses: Address[]) {
    const current = this.user();
    if (current) this.user.set({ ...current, addresses });
  }

  private clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    this.user.set(null);
  }
}
