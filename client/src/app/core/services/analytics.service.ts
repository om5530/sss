import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Google Analytics 4, enabled only when a measurement id is configured in the
 * environment file. Page views are sent manually on router navigation so SPA
 * route changes are counted.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private router = inject(Router);
  private started = false;

  start(): void {
    const id = environment.gaMeasurementId;
    if (this.started || !id) return;
    this.started = true;

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: false });

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      window.gtag?.('event', 'page_view', {
        page_path: (e as NavigationEnd).urlAfterRedirects,
        page_title: document.title,
      });
    });
  }
}
