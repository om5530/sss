import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminSessionService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private deadline = 0;
  private lastTouch = 0;
  private busy = false;
  private expired = false;
  private generation = 0;
  private saveDraft?: () => void;

  preserveDraft(save: () => void) { this.saveDraft = save; return () => { if (this.saveDraft === save) this.saveDraft = undefined; }; }
  keepDraft() { this.saveDraft?.(); }

  start() {
    this.generation++;
    this.busy = false;
    this.expired = false;
    this.deadline = 0;
    this.lastTouch = 0;
    this.check();
    const activity = (event: Event) => {
      if (event.isTrusted && document.visibilityState === 'visible') this.touch();
    };
    const timer = window.setInterval(() => {
      if (this.deadline && Date.now() >= this.deadline) this.expire();
      else this.check(); // Read-only: polling must not renew the session.
    }, 10_000);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      this.generation++;
      clearInterval(timer);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }

  private check() {
    if (this.expired || this.busy) return;
    const generation = this.generation;
    this.http.get<{ idleExpiresAt?: string }>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (res) => { if (generation === this.generation && res.idleExpiresAt) this.deadline = Math.max(this.deadline, Date.parse(res.idleExpiresAt)); },
      error: (err) => { if (generation === this.generation && (err.status === 401 || err.status === 403)) this.expire(); },
    });
  }

  private touch() {
    if (this.expired || this.busy || Date.now() - this.lastTouch < 15_000) return;
    this.busy = true;
    const generation = this.generation;
    this.http.post<{ idleExpiresAt: string }>(`${environment.apiUrl}/auth/activity`, {}).subscribe({
      next: (res) => { if (generation !== this.generation) return; this.deadline = Date.parse(res.idleExpiresAt); this.lastTouch = Date.now(); this.busy = false; },
      error: (err) => { if (generation !== this.generation) return; this.busy = false; if (err.status === 401 || err.status === 403) this.expire(); },
    });
  }

  private expire() {
    if (this.expired) return;
    this.expired = true;
    this.saveDraft?.();
    const returnUrl = this.router.url;
    this.auth.clearSession();
    this.toast.info('Your admin session expired. Sign in again to continue. Unsaved product edits are kept in this tab.');
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }
}
