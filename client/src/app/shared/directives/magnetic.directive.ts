import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, numberAttribute } from '@angular/core';
import { isTouchDevice, prefersReducedMotion } from '../motion/gsap';

/**
 * Magnetic hover — the element gravitates toward the cursor while hovered
 * and springs back on leave. `[appMagnetic]="0.35"` sets the pull strength.
 * Desktop-pointer only; no-op for touch / reduced motion.
 */
@Directive({ selector: '[appMagnetic]' })
export class Magnetic implements AfterViewInit, OnDestroy {
  readonly appMagnetic = input(0.32, { transform: numberAttribute });

  private el = inject(ElementRef<HTMLElement>);
  private frame = 0;
  private target = { x: 0, y: 0 };
  private current = { x: 0, y: 0 };
  private active = false;
  private listeners: Array<() => void> = [];

  ngAfterViewInit(): void {
    if (prefersReducedMotion() || isTouchDevice()) return;

    const node = this.el.nativeElement;
    node.style.willChange = 'transform';

    const onMove = (e: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const strength = this.appMagnetic();
      this.target = {
        x: (e.clientX - rect.left - rect.width / 2) * strength,
        y: (e.clientY - rect.top - rect.height / 2) * strength,
      };
      if (!this.active) { this.active = true; this.loop(); }
    };
    const onLeave = () => { this.target = { x: 0, y: 0 }; };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    this.listeners = [
      () => node.removeEventListener('pointermove', onMove),
      () => node.removeEventListener('pointerleave', onLeave),
    ];
  }

  private loop = () => {
    const node = this.el.nativeElement;
    this.current.x += (this.target.x - this.current.x) * 0.14;
    this.current.y += (this.target.y - this.current.y) * 0.14;
    node.style.transform = `translate3d(${this.current.x.toFixed(2)}px, ${this.current.y.toFixed(2)}px, 0)`;

    const settled = Math.abs(this.current.x - this.target.x) < 0.05 && Math.abs(this.current.y - this.target.y) < 0.05;
    if (settled && this.target.x === 0 && this.target.y === 0) {
      node.style.transform = '';
      this.active = false;
      return;
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.listeners.forEach((off) => off());
  }
}
