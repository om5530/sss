import { BusyButton } from '../shared/busy-button';
import { Component, DestroyRef, Injector, afterNextRender, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, merge, switchMap, timer } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AdminSessionService } from '../../../core/services/admin-session.service';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppInstallService } from '../../../core/services/app-install.service';
// import { AdminOrderNotificationService } from '../../../core/services/admin-order-notification.service';
import { AdminProductListState } from '../shared/admin-product-list-state';
import { AdminThemeService } from '../../../core/services/admin-theme.service';
import { AdminRequestActivity } from '../../../core/services/admin-request-activity.service';

@Component({
  selector: 'app-admin-layout',
  imports: [BusyButton, RouterOutlet, RouterLink, RouterLinkActive],
  providers: [AdminProductListState],
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  private readonly injector = inject(Injector);
  protected readonly requestActivity = inject(AdminRequestActivity);
  protected readonly theme = inject(AdminThemeService);
  protected readonly install = inject(AppInstallService);
  // Cafe live order alerts are temporarily disabled for manual WhatsApp orders.
  // protected readonly orderNotification = inject(AdminOrderNotificationService);
  protected readonly unreadEnquiries = signal<number | null>(null);
  protected readonly bakeryOpen = signal<boolean>(true);
  protected readonly toolsOpen = signal(false);
  protected readonly mobileNavOpen = signal(false);
  protected readonly mobileViewport = signal(matchMedia('(max-width: 960px)').matches);
  protected readonly isOffline = signal(!navigator.onLine);
  protected readonly wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  protected readonly isScreenAwake = signal(false);
  private wakeLockSentinel: any = null;
  protected auth = inject(AuthService);
  private router = inject(Router);
  private session = inject(AdminSessionService);
  constructor() {
    const destroy = inject(DestroyRef);
    const mobileQuery = matchMedia('(max-width: 960px)');
    const onResize = () => {
      this.mobileViewport.set(mobileQuery.matches);
      if (!mobileQuery.matches) this.mobileNavOpen.set(false);
    };
    mobileQuery.addEventListener('change', onResize);
    destroy.onDestroy(() => mobileQuery.removeEventListener('change', onResize));
    effect((onCleanup) => {
      if (!this.mobileViewport() || !this.mobileNavOpen()) return;
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      onCleanup(() => document.body.style.overflow = previous);
    });
    this.router.events.pipe(takeUntilDestroyed(destroy)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        if (this.mobileNavOpen()) this.closeMobileNav();
        this.toolsOpen.set(false);
      }
    });
    const admin = inject(AdminService);
    merge(timer(0, 30_000), admin.enquiryChanges).pipe(
      switchMap(() => admin.unreadEnquiries().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(destroy),
    ).subscribe((res) => this.unreadEnquiries.set(res.newCount));
    destroy.onDestroy(inject(AdminSessionService).start());

    // Restore background polling alongside the cafe live queue.
    // this.orderNotification.start();
    // destroy.onDestroy(() => this.orderNotification.stop());

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

  protected openMobileNav() {
    this.toolsOpen.set(false);
    this.mobileNavOpen.set(true);
    afterNextRender(() => requestAnimationFrame(() => {
      if (this.mobileNavOpen()) document.getElementById('admin-menu-close')?.focus();
    }), { injector: this.injector });
  }

  protected closeMobileNav() {
    this.mobileNavOpen.set(false);
    document.getElementById('admin-menu-toggle')?.focus();
  }

  protected onMenuKeydown(event: KeyboardEvent) {
    if (!this.mobileViewport() || !this.mobileNavOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMobileNav();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('#admin-menu a[href], #admin-menu button, #admin-menu [tabindex="0"]'))
      .filter((element) => element.getClientRects().length && !element.hasAttribute('disabled'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
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
    // this.orderNotification.stop();
    if (!await this.auth.logout()) return;
    this.router.navigateByUrl('/');
  }
}
