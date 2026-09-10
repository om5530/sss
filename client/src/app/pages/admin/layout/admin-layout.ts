import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, merge, switchMap, timer } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AdminSessionService } from '../../../core/services/admin-session.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppInstallService } from '../../../core/services/app-install.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  protected readonly install = inject(AppInstallService);
  protected readonly unreadEnquiries = signal<number | null>(null);
  protected readonly bakeryOpen = signal<boolean>(true);
  protected readonly mobileNavOpen = signal(false);
  protected readonly isOffline = signal(!navigator.onLine);
  protected readonly wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  protected readonly isScreenAwake = signal(false);
  private wakeLockSentinel: any = null;
  protected auth = inject(AuthService);
  private router = inject(Router);
  private session = inject(AdminSessionService);
  constructor() {
    const destroy = inject(DestroyRef);
    this.router.events.pipe(takeUntilDestroyed(destroy)).subscribe(e => { if(e instanceof NavigationEnd) this.mobileNavOpen.set(false); });
    const admin = inject(AdminService);
    merge(timer(0, 30_000), admin.enquiryChanges).pipe(
      switchMap(() => admin.unreadEnquiries().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(destroy),
    ).subscribe((res) => this.unreadEnquiries.set(res.newCount));
    destroy.onDestroy(inject(AdminSessionService).start());
    const http = inject(HttpClient);
    let running = false;
    const dispatch = () => {
      if (running || !this.auth.isAuthenticated()) return;
      running = true;
      http.post(`${environment.apiUrl}/admin/notifications/dispatch`, {}).subscribe({
        next: () => { running = false; }, error: () => { running = false; },
      });
    };
    dispatch();
    const dispatchTimer = window.setInterval(dispatch, 30_000);
    destroy.onDestroy(() => clearInterval(dispatchTimer));

    // Offline/online tracking for the connectivity banner
    const onOnline = () => this.isOffline.set(false);
    const onOffline = () => this.isOffline.set(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    destroy.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });

    // Screen Wake Lock auto-reacquire on tab focus
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && this.isScreenAwake() && !this.wakeLockSentinel) {
        await this.requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    destroy.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      this.releaseWakeLock();
    });
  }

  async toggleWakeLock() {
    if (!this.wakeLockSupported) return;
    if (this.isScreenAwake()) {
      await this.releaseWakeLock();
    } else {
      await this.requestWakeLock();
    }
  }

  private async requestWakeLock() {
    try {
      this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      this.isScreenAwake.set(true);
      this.wakeLockSentinel.addEventListener('release', () => {
        this.isScreenAwake.set(false);
        this.wakeLockSentinel = null;
      });
    } catch {
      this.isScreenAwake.set(false);
      this.wakeLockSentinel = null;
    }
  }

  private async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
    }
    this.isScreenAwake.set(false);
  }

  async signOut() {
    this.session.keepDraft();
    this.releaseWakeLock();
    if (!await this.auth.logout()) return;
    this.router.navigateByUrl('/');
  }
}
