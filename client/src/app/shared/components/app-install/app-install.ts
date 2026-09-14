import { Component, inject } from '@angular/core';
import { AppInstallService } from '../../../core/services/app-install.service';

@Component({
  selector: 'app-install',
  template: `
    @if (install.visible()) {
      <aside class="install install--popup" aria-label="Install The Golden Batch" aria-live="polite">
        <img src="icons/golden-batch-icon-192.png" width="52" height="52" alt="" />
        <div class="install__copy">
          <strong>Install The Golden Batch app</strong>
          <p>Install once for faster ordering and reliable order updates.</p>
        </div>
        <div class="install__actions">
          <button type="button" class="btn btn--primary btn--sm" (click)="install.install()" [disabled]="install.busy()" aria-controls="install-help" [attr.aria-expanded]="install.instructions()">
            {{ install.nativeAvailable() ? 'Install app' : 'Show install steps' }}
          </button>
        </div>
        @if (install.instructions()) {
          <div id="install-help" class="install__help" role="status">
            @if (install.ios) {
              In Safari, tap <strong>Share</strong>, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong> to install the app.
            } @else {
              Open this page in Chrome, open the browser menu, and choose <strong>Install app</strong>. If you only see “Add to Home screen”, Chrome has not enabled full app installation for this page yet.
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
    .install button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
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
