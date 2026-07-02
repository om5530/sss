import { Component, computed, effect, inject, signal } from '@angular/core';
import { Toast, ToastService } from '../../../core/services/toast.service';

interface ToastView extends Toast {
  leaving: boolean;
}

/** How long the exit choreography (fade + rise + stack collapse) plays. */
const EXIT_MS = 460;

@Component({
  selector: 'app-toast-container',
  templateUrl: './toast-container.html',
  styleUrl: './toast-container.scss',
})
export class ToastContainer {
  protected toast = inject(ToastService);

  /** Presentation-only: toasts the service already dismissed, still playing exit. */
  private readonly leaving = signal<ReadonlyMap<number, Toast>>(new Map());

  /** Snapshot of live toasts so removals can be detected and animated out. */
  private readonly seen = new Map<number, Toast>();

  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Live + leaving toasts merged in arrival order (ids are monotonic). */
  protected readonly view = computed<ToastView[]>(() => {
    const live = this.toast.toasts();
    const liveIds = new Set(live.map((t) => t.id));
    const rows: ToastView[] = live.map((t) => ({ ...t, leaving: false }));
    for (const t of this.leaving().values()) {
      if (!liveIds.has(t.id)) rows.push({ ...t, leaving: true });
    }
    rows.sort((a, b) => a.id - b.id);
    return rows;
  });

  constructor() {
    effect(() => {
      const liveIds = new Set(this.toast.toasts().map((t) => t.id));
      for (const t of this.toast.toasts()) this.seen.set(t.id, t);
      for (const [id, t] of [...this.seen]) {
        if (!liveIds.has(id)) {
          this.seen.delete(id);
          this.beginExit(t);
        }
      }
    });
  }

  protected dismiss(t: ToastView): void {
    if (!t.leaving) this.toast.dismiss(t.id);
  }

  private beginExit(t: Toast): void {
    if (this.reducedMotion) return; // remove instantly — page stays readable
    this.leaving.update((m) => new Map(m).set(t.id, t));
    setTimeout(() => {
      this.leaving.update((m) => {
        if (!m.has(t.id)) return m;
        const next = new Map(m);
        next.delete(t.id);
        return next;
      });
    }, EXIT_MS);
  }
}
