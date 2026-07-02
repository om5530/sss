import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

const DEFAULT_DESCRIPTION =
  'Small-batch brownies, cookies, cakes, wood-fired pizza and barista coffee — order for dine-in, takeaway or delivery.';
const DEFAULT_IMAGE = '/baking-flour-poster.jpg';

/**
 * Keeps per-route meta tags (description, OpenGraph, canonical) in sync so
 * shared links preview properly on WhatsApp/social. Route `data.description`
 * drives static pages; product pages call `set()` with specifics.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private meta = inject(Meta);
  private title = inject(Title);

  private started = false;

  /** Called once from the app root. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      // Deepest activated route carries the data.
      let deepest = this.route.snapshot;
      while (deepest.firstChild) deepest = deepest.firstChild;
      const description = (deepest.data?.['description'] as string) || DEFAULT_DESCRIPTION;
      this.apply({ description, path: (e as NavigationEnd).urlAfterRedirects });
    });
  }

  /** Page-specific override (e.g. product detail once the product loads). */
  set(opts: { title?: string; description?: string; image?: string }): void {
    if (opts.title) this.title.setTitle(opts.title);
    this.apply({ description: opts.description, image: opts.image, path: this.router.url });
  }

  private apply({ description, image, path }: { description?: string; image?: string; path: string }): void {
    // The Title strategy has already set document.title from route config.
    const title = this.title.getTitle();
    const origin = location.origin;

    if (description) {
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ property: 'og:description', content: description });
    }
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:url', content: origin + path });
    const img = image || DEFAULT_IMAGE;
    this.meta.updateTag({ property: 'og:image', content: /^https?:\/\//.test(img) ? img : origin + img });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });

    // Canonical link — create once, then retarget per navigation.
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = origin + path.split('?')[0].split('#')[0];
  }
}
