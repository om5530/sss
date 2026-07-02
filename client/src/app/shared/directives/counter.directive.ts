import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, numberAttribute } from '@angular/core';

/**
 * Count-up number. `[appCounter]="4200"` animates the element's text from 0
 * to the target the first time it scrolls into view (ease-out cubic, ~1.8s).
 * `[counterDecimals]` controls fraction digits. Reduced motion ⇒ final value.
 */
@Directive({ selector: '[appCounter]' })
export class Counter implements AfterViewInit, OnDestroy {
  readonly appCounter = input(0, { transform: numberAttribute });
  readonly counterDecimals = input(0, { transform: numberAttribute });

  private el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;
  private frame = 0;

  ngAfterViewInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      this.el.nativeElement.textContent = this.format(this.appCounter());
      return;
    }

    this.el.nativeElement.textContent = this.format(0);
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.observer?.disconnect();
          this.run();
        }
      },
      { threshold: 0.4 },
    );
    this.observer.observe(this.el.nativeElement);
  }

  private run(): void {
    const duration = 1800;
    const target = this.appCounter();
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.el.nativeElement.textContent = this.format(target * eased);
      if (t < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private format(value: number): string {
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: this.counterDecimals(),
      maximumFractionDigits: this.counterDecimals(),
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
  }
}
