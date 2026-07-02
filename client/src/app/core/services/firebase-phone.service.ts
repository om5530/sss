import { Injectable } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  ConfirmationResult,
  RecaptchaVerifier,
  getAuth,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { environment } from '../../../environments/environment';

/**
 * Wraps Firebase Phone Authentication. Firebase sends and verifies the SMS OTP
 * entirely on the client; we then hand the resulting ID token to our own API
 * (POST /auth/firebase-phone) which verifies it and issues our session.
 *
 * Disabled automatically when environment.firebase.apiKey is empty — the login
 * page then falls back to the backend mock-OTP flow.
 */
@Injectable({ providedIn: 'root' })
export class FirebasePhoneService {
  readonly enabled = !!environment.firebase.apiKey;

  private auth?: Auth;
  private verifier?: RecaptchaVerifier;
  private confirmation?: ConfirmationResult;

  private getAuthInstance(): Auth {
    if (!this.auth) {
      const app: FirebaseApp = getApps().length ? getApp() : initializeApp(environment.firebase);
      this.auth = getAuth(app);
    }
    return this.auth;
  }

  /**
   * Sends an SMS OTP to a phone number in E.164 format (e.g. +919921279128).
   * `containerId` is the id of a DOM element that hosts the invisible reCAPTCHA.
   */
  async sendCode(phoneE164: string, containerId: string): Promise<void> {
    const auth = this.getAuthInstance();
    // Recreate the verifier each attempt to avoid "reCAPTCHA already rendered".
    this.verifier?.clear();
    this.verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
    this.confirmation = await signInWithPhoneNumber(auth, phoneE164, this.verifier);
  }

  /** Confirms the entered code and returns a Firebase ID token for the server. */
  async confirmCode(code: string): Promise<string> {
    if (!this.confirmation) throw new Error('Request a code before verifying.');
    const cred = await this.confirmation.confirm(code);
    return cred.user.getIdToken();
  }

  /** Clears verifier/confirmation state, e.g. when the user changes number. */
  reset(): void {
    this.verifier?.clear();
    this.verifier = undefined;
    this.confirmation = undefined;
  }
}
