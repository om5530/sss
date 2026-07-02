import { Component, afterNextRender, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { FirebasePhoneService } from '../../core/services/firebase-phone.service';
import { ToastService } from '../../core/services/toast.service';
import { environment } from '../../../environments/environment';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { categoryImage } from '../../core/utils/food-image';

const RECAPTCHA_CONTAINER_ID = 'recaptcha-container';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, RevealOnScroll],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private auth = inject(AuthService);
  private fb = inject(FirebasePhoneService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);

  protected readonly step = signal<'phone' | 'code'>('phone');
  protected readonly phone = signal('');
  protected readonly code = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMsg = signal('');
  protected readonly devCode = signal<string | undefined>(undefined);
  protected readonly resendIn = signal(0);
  protected readonly googleEnabled = !!environment.googleClientId;
  // When Firebase is configured, real SMS OTP is used instead of the backend
  // mock flow (which is what surfaces the on-screen "Dev mode" code).
  protected readonly firebaseEnabled = this.fb.enabled;

  /* ---- Presentation only: curated photography for the visual panel ---- */
  protected readonly visualPhoto = categoryImage('Pastries');
  protected readonly visualChips = [
    { label: 'Fudge Brownie', tag: 'Gooey centre · still warm', image: categoryImage('Brownies') },
    { label: 'Classic Tiramisu', tag: 'Espresso-soaked', image: categoryImage('Tiramisu') },
  ];

  private returnUrl = '/';
  private resendTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    if (this.auth.isAuthenticated()) this.router.navigateByUrl(this.returnUrl);
    afterNextRender(() => this.initGoogle());
  }

  requestOtp() {
    const raw = this.phone().trim();
    if (!/^\+?[0-9\s()-]{7,20}$/.test(raw)) {
      this.errorMsg.set('Enter a valid phone number (with country code).');
      return;
    }
    this.errorMsg.set('');
    this.loading.set(true);

    // Production path: Firebase sends the SMS directly from the browser.
    if (this.firebaseEnabled) {
      const e164 = this.toE164(raw);
      this.phone.set(e164);
      this.fb
        .sendCode(e164, RECAPTCHA_CONTAINER_ID)
        .then(() => {
          this.loading.set(false);
          this.step.set('code');
          this.startResendCooldown(30);
          this.toast.success('OTP sent to your phone.');
        })
        .catch((err) => {
          this.loading.set(false);
          this.errorMsg.set(this.firebaseError(err));
        });
      return;
    }

    // Dev fallback: backend mock OTP (returns the code for the on-screen badge).
    this.auth.requestOtp(raw).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.step.set('code');
        this.devCode.set(res.devCode);
        this.startResendCooldown(30);
        this.toast.success('OTP sent to your phone.');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.message || 'Could not send OTP. Try again.');
      },
    });
  }

  verifyOtp() {
    const code = this.code().trim();
    if (code.length < 4) {
      this.errorMsg.set('Enter the OTP you received.');
      return;
    }
    this.errorMsg.set('');
    this.loading.set(true);

    if (this.firebaseEnabled) {
      this.fb
        .confirmCode(code)
        .then((idToken) => this.finishLogin(this.auth.firebasePhoneLogin(idToken)))
        .catch((err) => {
          this.loading.set(false);
          this.errorMsg.set(this.firebaseError(err));
        });
      return;
    }

    this.finishLogin(this.auth.verifyOtp(this.phone().trim(), code));
  }

  changeNumber() {
    this.step.set('phone');
    this.code.set('');
    this.errorMsg.set('');
    this.devCode.set(undefined);
    if (this.firebaseEnabled) this.fb.reset();
  }

  /** Shared handler for both the Firebase and mock verify observables. */
  private finishLogin(login$: ReturnType<AuthService['verifyOtp']>) {
    login$.subscribe({
      next: () => {
        this.loading.set(false);
        this.toast.success('Signed in successfully.');
        this.router.navigateByUrl(this.returnUrl);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.message || 'Invalid OTP. Try again.');
      },
    });
  }

  /** Normalises input to E.164; a bare number defaults to +91 (India). */
  private toE164(raw: string): string {
    const cleaned = raw.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    return '+91' + cleaned.replace(/^0+/, '');
  }

  private firebaseError(err: unknown): string {
    const code = (err as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-phone-number':
        return 'That phone number looks invalid. Include the country code.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a while and try again.';
      case 'auth/invalid-verification-code':
        return 'Incorrect code. Please check and try again.';
      case 'auth/code-expired':
        return 'That code expired. Request a new one.';
      case 'auth/captcha-check-failed':
      case 'auth/missing-app-credential':
        return 'Verification check failed. Reload the page and try again.';
      default:
        return 'Could not complete phone verification. Please try again.';
    }
  }

  private startResendCooldown(seconds: number) {
    this.resendIn.set(seconds);
    clearInterval(this.resendTimer);
    this.resendTimer = setInterval(() => {
      const next = this.resendIn() - 1;
      this.resendIn.set(next);
      if (next <= 0) clearInterval(this.resendTimer);
    }, 1000);
  }

  private initGoogle() {
    if (!this.googleEnabled) return;
    const w = window as unknown as { google?: any };
    const render = () => {
      w.google?.accounts.id.initialize({
        client_id: environment.googleClientId,
        callback: (resp: { credential: string }) => this.onGoogleCredential(resp.credential),
      });
      const el = document.getElementById('googleBtn');
      if (el) w.google?.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', width: 320 });
    };

    if (w.google?.accounts?.id) return render();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
  }

  private onGoogleCredential(idToken: string) {
    this.loading.set(true);
    this.auth.googleLogin(idToken).subscribe({
      next: () => {
        this.loading.set(false);
        this.toast.success('Signed in with Google.');
        this.router.navigateByUrl(this.returnUrl);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.message || 'Google sign-in failed.');
      },
    });
  }
}
