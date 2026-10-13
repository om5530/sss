import { Component, afterNextRender, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationError, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Navbar } from './shared/components/navbar/navbar';
import { Footer } from './shared/components/footer/footer';
import { AppInstall } from './shared/components/app-install/app-install';
import { ToastContainer } from './shared/components/toast/toast-container';
import { AnalyticsService } from './core/services/analytics.service';
import { MotionService } from './core/services/motion.service';
import { SeoService } from './core/services/seo.service';
import { AdminThemeService } from './core/services/admin-theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Footer, ToastContainer, AppInstall],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private motion = inject(MotionService);
  private seo = inject(SeoService);
  private analytics = inject(AnalyticsService);
  private router = inject(Router);
  private theme = inject(AdminThemeService);

  /** The admin console ships its own chrome — hide the storefront's.
   *  Seeded from the URL so a hard load of /admin never flashes the navbar. */
  protected readonly adminArea = signal(location.pathname.startsWith('/admin'));

  constructor() {
    // Smooth scrolling (Lenis + GSAP) boots after first paint; it degrades to
    // native scrolling for reduced-motion users inside the service itself.
    afterNextRender(() => void this.motion.start());
    this.seo.start();
    this.analytics.start();

    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) {
        window.dispatchEvent(new Event('app-startup-ready'));
        const admin = /^\/admin(?:\/|[?#]|$)/.test(e.urlAfterRedirects);
        this.adminArea.set(admin);
        this.theme.setAdminArea(admin);
        const manifest = document.querySelector<HTMLLinkElement>('#pwa-manifest');
        if (manifest) manifest.href = admin ? '/admin-manifest.webmanifest' : '/manifest.webmanifest';
        const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
        if (title) title.content = admin ? 'GB Ops' : 'The Golden Batch';
      } else if (e instanceof NavigationError) {
        window.dispatchEvent(new Event('app-startup-failed'));
      }
    });
  }
}
