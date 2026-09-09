import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  ConfirmationResult,
  RecaptchaVerifier,
  getAuth,
  signInWithPhoneNumber,
  inMemoryPersistence,
  setPersistence,
  signOut,
} from 'firebase/auth';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Wraps Firebase Phone Authentication. Firebase sends and verifies the SMS OTP
 * entirely on the client; we then hand the resulting ID token to our own API
 * (POST /auth/firebase-phone) which verifies it and issues our session.
 *
 * The API selects Firebase, local mock mode, or disabled phone sign-in.
 */
@Injectable({ providedIn: 'root' })
export class FirebasePhoneService {
  private http = inject(HttpClient);
  private config = environment.firebase;
  private mode: 'firebase' | 'mock' | 'disabled' = 'disabled';
  get enabled() { return this.mode === 'firebase'; }
  async configure() {
    const result = await firstValueFrom(this.http.get<{ mode: 'firebase' | 'mock' | 'disabled'; firebase?: typeof environment.firebase }>(`${environment.apiUrl}/auth/phone-config`));
    this.mode = result.mode;
    if (result.firebase) {
      this.config = { ...environment.firebase, ...Object.fromEntries(Object.entries(result.firebase).filter(([, value]) => !!value)) };
    }
    if (this.mode === 'disabled' || (this.enabled && (!this.config.apiKey || !this.config.projectId || !this.config.authDomain))) {
      throw new Error('Phone sign-in is not available yet. Please contact the café.');
    }
  }

  private auth?: Auth;
  private verifier?: RecaptchaVerifier;
  private confirmation?: ConfirmationResult;
  private generation = 0;

  private getAuthInstance(): Auth {
    if (!this.auth) {
      const app: FirebaseApp = getApps().length ? getApp() : initializeApp(this.config);
      this.auth = getAuth(app);
    }
    return this.auth;
  }

  /**
   * Sends an SMS OTP to a phone number in E.164 format (e.g. +919921279128).
   * `containerId` is the id of a DOM element that hosts the invisible reCAPTCHA.
   */
  async sendCode(phoneE164: string, containerId: string): Promise<void> {
    this.reset();
    const generation = this.generation;
    const auth = this.getAuthInstance();
    await setPersistence(auth, inMemoryPersistence);
    if (generation !== this.generation) throw new Error('Phone verification was cancelled.');
    const container = document.getElementById(containerId);
    if (!container || !container.isConnected) throw new Error('Phone verification container is unavailable.');
    auth.useDeviceLanguage();
    const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
    this.verifier = verifier;
    try {
      // Render on the mounted login page before Firebase executes the challenge.
      // Firebase provisions the reCAPTCHA keys and handles token expiry.
      await verifier.render();
      if (generation !== this.generation) throw new Error('Phone verification was cancelled.');
      const confirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
      if (generation !== this.generation) throw new Error('Phone verification was cancelled.');
      this.confirmation = confirmation;
    } finally {
      // A send failure leaves no spent CAPTCHA behind. The next attempt creates
      // a fresh verifier; successful sends retain only the OTP confirmation.
      if (this.verifier === verifier) {
        this.verifier = undefined;
        verifier.clear();
      }
    }
  }

  /** Confirms the entered code and returns a Firebase ID token for the server. */
  async confirmCode(code: string): Promise<string> {
    if (!this.confirmation) throw new Error('Request a code before verifying.');
    const cred = await this.confirmation.confirm(code);
    const token = await cred.user.getIdToken();
    await signOut(this.getAuthInstance());
    this.reset();
    return token;
  }

  /** Clears verifier/confirmation state, e.g. when the user changes number. */
  reset(): void {
    this.generation++;
    this.verifier?.clear();
    this.verifier = undefined;
    this.confirmation = undefined;
  }
}
