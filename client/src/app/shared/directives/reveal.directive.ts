import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, numberAttribute } from '@angular/core';

export type RevealVariant = '' | 'fade' | 'left' | 'right' | 'zoom' | 'blur' | 'group';

/**
 * Scroll-triggered reveal. Adds `.is-in` when the element enters the viewport,
 * driving the CSS transitions defined in styles.scss.
 *
 * Variants (via the attribute value):
 *   `appReveal`          → fade-up (default)
 *   `appReveal="left"`   → slide in from the left
 *   `appReveal="right"`  → slide in from the right
 *   `appReveal="zoom"`   → scale up
 *   `appReveal="blur"`   → de-blur + rise
 *   `appReveal="group"`  → stagger direct children
 *
 * `[revealDelay]` (ms) offsets the transition for hand-tuned choreography.
 * Falls back to instantly-visible for reduced motion / no IntersectionObserver.
 */
@Directive({ selector: '[appReveal]' })
export class RevealOnScroll implements AfterViewInit, OnDestroy {
  readonly appReveal = input<RevealVariant>('');
  readonly revealDelay = input(0, { transform: numberAttribute });

  private el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    const node = this.el.nativeElement;
    const variant = this.appReveal();

    if (variant === 'group') {
      node.classList.add('reveal-group');
    } else {
      node.classList.add('reveal');
      if (variant) node.classList.add(`reveal--${variant}`);
    }
    if (this.revealDelay() > 0) node.style.transitionDelay = `${this.revealDelay()}ms`;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      node.classList.add('is-in');
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    );
    this.observer.observe(node);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
