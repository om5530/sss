import { Component, inject } from '@angular/core';
import { AppInstallService } from '../../../core/services/app-install.service';

@Component({
  selector: 'app-install',
  template: `
    @if (install.visible()) {
      <aside class="install install--popup" aria-label="Install The Golden Batch" aria-live="polite">
        <button type="button" class="install__close" (click)="install.dismiss()" aria-label="Dismiss install prompt">×</button>
        <img src="icons/icon-192.png" width="52" height="52" alt="" />
        <div class="install__copy">
          <strong>Install The Golden Batch</strong>
          <p>Keep the bakery menu and your orders one tap away.</p>
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
    .install--popup { position: fixed; z-index: 1200; inset-inline: 12px; bottom: max(12px, env(safe-area-inset-bottom)); max-width: 520px; margin: 0 auto; padding: .8rem; background: rgba(250,244,234,.98); box-shadow: 0 12px 36px rgba(28,15,8,.28); }
    .install__close { position: absolute; top: 5px; right: 7px; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--muted); font-size: 1.35rem; line-height: 1; cursor: pointer; }
    .install__close:focus-visible, .install button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
    .install > img { flex-shrink: 0; border-radius: 12px; }
    .install__copy { flex: 1 1 180px; min-width: 0; }
    .install strong { color: var(--choco); }
    .install p { font-size: .88rem; margin: .3rem 0 0; }
    .install__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .install__actions button { min-height: 44px; }
    .install__help { flex-basis: 100%; border-top: 1px solid var(--line); padding-top: .9rem; font-size: .9rem; line-height: 1.7; }
    @media (max-width: 700px) { .install--popup { inset-inline: 8px; gap: .7rem; } .install--popup > img { width: 44px; height: 44px; } .install__copy { flex: 1 1 150px; padding-right: 18px; } .install__copy strong { font-size: .92rem; } .install__copy p { font-size: .78rem; } .install__actions { flex: 1 0 100%; padding-left: 52px; } .install__actions button { flex: 1; } }
    @media (max-width: 400px) { .install { gap: .6rem; } .install__actions { padding-left: 0; } }
    @media print { :host { display: none; } }
  `,
})
export class AppInstall {
  protected install = inject(AppInstallService);
}
