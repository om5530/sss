import { Injectable, computed, signal } from '@angular/core';
import { AdminRequestKind, AdminRequestState } from '../utils/admin-request-state';

@Injectable({ providedIn: 'root' })
export class AdminRequestActivity {
  private readonly state = new AdminRequestState();
  readonly kind = signal<AdminRequestKind | null>(null);
  readonly slow = signal(false);
  readonly message = computed(() => this.slow() ? 'Still working… Please keep this page open.'
    : this.kind() === 'saving' ? 'Saving changes…'
    : this.kind() === 'calculating' ? 'Calculating…' : 'Loading data…');
  private slowTimer?: ReturnType<typeof setTimeout>;

  begin(kind: AdminRequestKind): () => void {
    const id = this.state.begin(kind);
    this.kind.set(this.state.kind);
    if (this.state.count === 1) {
      this.slow.set(false);
      this.slowTimer = setTimeout(() => this.slow.set(true), 10_000);
    }
    return () => {
      this.state.end(id);
      this.kind.set(this.state.kind);
      if (!this.state.count) {
        clearTimeout(this.slowTimer);
        this.slow.set(false);
      }
    };
  }
}
