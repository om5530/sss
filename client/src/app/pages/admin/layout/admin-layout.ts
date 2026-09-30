import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, merge, switchMap, timer } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AdminSessionService } from '../../../core/services/admin-session.service';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { AppInstallService } from '../../../core/services/app-install.service';
import { AdminOrderNotificationService } from '../../../core/services/admin-order-notification.service';
import { AdminProductListState } from '../shared/admin-product-list-state';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UpperCasePipe],
  providers: [AdminProductListState],
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  protected readonly install = inject(AppInstallService);
  protected readonly orderNotification = inject(AdminOrderNotificationService);
  protected readonly unreadEnquiries = signal<number | null>(null);
  protected readonly bakeryOpen = signal<boolean>(true);
  protected readonly toolsOpen = signal(false);
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
    const revealTools = (url: string) => {
      if (/^\/admin\/(activity|qr|reports|coupons|enquiries|prep)(?:[/?#]|$)/.test(url)) {
        this.toolsOpen.set(true);
      }
    };
    revealTools(this.router.url);
    this.router.events.pipe(takeUntilDestroyed(destroy)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.mobileNavOpen.set(false);
        revealTools(event.urlAfterRedirects);
      }
    });
    const admin = inject(AdminService);
    merge(timer(0, 30_000), admin.enquiryChanges).pipe(
      switchMap(() => admin.unreadEnquiries().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(destroy),
    ).subscribe((res) => this.unreadEnquiries.set(res.newCount));
    destroy.onDestroy(inject(AdminSessionService).start());

    // Start background polling for new incoming orders with loud alarm chime
    this.orderNotification.start();
    destroy.onDestroy(() => this.orderNotification.stop());

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
    this.orderNotification.stop();
    if (!await this.auth.logout()) return;
    this.router.navigateByUrl('/');
  }
}
