import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { loadGsap, prefersReducedMotion } from '../../shared/motion/gsap';

/**
 * App-wide motion orchestrator: buttery Lenis smooth scrolling kept in
 * lock-step with GSAP ScrollTrigger, plus route-change scroll resets.
 *
 * Reduced-motion users get native scrolling and no smoothing at all —
 * the service becomes a no-op shell.
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private router = inject(Router);
  private lenis?: import('lenis').default;
  private started = false;

  readonly reducedMotion = prefersReducedMotion();

  /** Called once from the app root. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Jump to top on navigation *immediately* so Lenis never animates
    // between two unrelated pages.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.lenis?.scrollTo(0, { immediate: true, force: true });
    });

    if (this.reducedMotion) return;

    const [{ default: Lenis }, { gsap, ScrollTrigger }] = await Promise.all([import('lenis'), loadGsap()]);

    this.lenis = new Lenis({
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.6,
    });

    this.lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => this.lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /** Smooth-scroll to an element (falls back to native for reduced motion). */
  scrollTo(target: HTMLElement | string, offset = -96): void {
    if (this.lenis) {
      this.lenis.scrollTo(target as HTMLElement, { offset, duration: 1.1 });
    } else {
      const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
      el?.scrollIntoView({ behavior: this.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  /** Pause/resume the smooth scroller (e.g. while a modal or drawer is open). */
  lock(locked: boolean): void {
    if (!this.lenis) return;
    locked ? this.lenis.stop() : this.lenis.start();
  }
}
