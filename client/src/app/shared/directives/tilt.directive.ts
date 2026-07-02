import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, numberAttribute } from '@angular/core';
import { isTouchDevice, prefersReducedMotion } from '../motion/gsap';

/**
 * Pointer-tracked 3D tilt. `[appTilt]="8"` sets the max tilt in degrees.
 * Lerped in a rAF loop for a weighty, premium feel; disabled for touch
 * devices and reduced-motion users.
 */
@Directive({ selector: '[appTilt]' })
export class Tilt implements AfterViewInit, OnDestroy {
  readonly appTilt = input(7, { transform: numberAttribute });

  private el = inject(ElementRef<HTMLElement>);
  private frame = 0;
  private target = { rx: 0, ry: 0 };
  private current = { rx: 0, ry: 0 };
  private active = false;
  private listeners: Array<() => void> = [];

  ngAfterViewInit(): void {
    if (prefersReducedMotion() || isTouchDevice()) return;

    const node = this.el.nativeElement;
    node.style.transformStyle = 'preserve-3d';
    node.style.willChange = 'transform';

    const onMove = (e: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      const max = this.appTilt();
      this.target = { rx: -py * max, ry: px * max };
      if (!this.active) { this.active = true; this.loop(); }
    };
    const onLeave = () => { this.target = { rx: 0, ry: 0 }; };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    this.listeners = [
      () => node.removeEventListener('pointermove', onMove),
      () => node.removeEventListener('pointerleave', onLeave),
    ];
  }

  private loop = () => {
    const node = this.el.nativeElement;
    this.current.rx += (this.target.rx - this.current.rx) * 0.12;
    this.current.ry += (this.target.ry - this.current.ry) * 0.12;
    node.style.transform = `perspective(900px) rotateX(${this.current.rx.toFixed(3)}deg) rotateY(${this.current.ry.toFixed(3)}deg)`;

    const settled =
      Math.abs(this.current.rx - this.target.rx) < 0.01 &&
      Math.abs(this.current.ry - this.target.ry) < 0.01;
    if (settled && this.target.rx === 0 && this.target.ry === 0) {
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
