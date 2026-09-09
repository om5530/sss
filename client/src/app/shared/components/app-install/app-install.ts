import { Component, inject } from '@angular/core';
import { AppInstallService } from '../../../core/services/app-install.service';

@Component({
  selector: 'app-install',
  template: `
    @if (install.visible()) {
      <aside class="install container" aria-label="Install The Golden Batch">
        <img src="icons/icon-192.png" width="52" height="52" alt="" />
        <div class="install__copy">
          <strong>Your favourites, a tap away</strong>
          <p>Add The Golden Batch to your home screen for easy ordering.</p>
        </div>
        <div class="install__actions">
          <button type="button" class="btn btn--primary btn--sm" (click)="install.install()" [disabled]="install.busy()" aria-controls="install-help" [attr.aria-expanded]="install.instructions()">
            {{ install.nativeAvailable() ? 'Install app' : 'Add to home screen' }}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="install.dismiss()">Not now</button>
        </div>
        @if (install.instructions()) {
          <div id="install-help" class="install__help" role="status">
            @if (install.ios) {
              Open this site in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> and <strong>Add</strong>.
            } @else {
              Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, if available. If you opened this inside another app, try opening it in Chrome.
            }
            <p>Ordering, payments and live order updates need an internet connection.</p>
          </div>
        }
      </aside>
    }
  `,
  styles: `
    :host { display: block; }
    .install { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-block: 1.5rem; padding: 1.2rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--cream-2); }
    .install > img { flex-shrink: 0; border-radius: 12px; }
    .install__copy { flex: 1 1 180px; min-width: 0; }
    .install strong { color: var(--choco); }
    .install p { font-size: .88rem; margin: .3rem 0 0; }
    .install__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .install__actions button { min-height: 44px; }
    .install__help { flex-basis: 100%; border-top: 1px solid var(--line); padding-top: .9rem; font-size: .9rem; line-height: 1.7; }
    @media (max-width: 400px) { .install { gap: .75rem; } .install__copy { flex-basis: 150px; } }
    @media print { :host { display: none; } }
  `,
})
export class AppInstall {
  protected install = inject(AppInstallService);
}
