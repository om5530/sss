import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, numberAttribute } from '@angular/core';
import { loadGsap, prefersReducedMotion } from '../motion/gsap';

/**
 * Scroll-scrubbed parallax drift. `[appParallax]="0.2"` moves the element
 * ±(speed × 160px) as it crosses the viewport; negative speeds drift the
 * opposite way. Powered by GSAP ScrollTrigger (synced with Lenis).
 */
@Directive({ selector: '[appParallax]' })
export class Parallax implements AfterViewInit, OnDestroy {
  readonly appParallax = input(0.18, { transform: numberAttribute });

  private el = inject(ElementRef<HTMLElement>);
  private trigger?: { kill: () => void };
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    if (prefersReducedMotion()) return;

    const { gsap } = await loadGsap();
    if (this.destroyed) return;

    const distance = this.appParallax() * 160;
    const tween = gsap.fromTo(
      this.el.nativeElement,
      { y: -distance },
      {
        y: distance,
        ease: 'none',
        scrollTrigger: {
          trigger: this.el.nativeElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6,
        },
      },
    );
    this.trigger = { kill: () => { tween.scrollTrigger?.kill(); tween.kill(); } };
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.trigger?.kill();
  }
}
