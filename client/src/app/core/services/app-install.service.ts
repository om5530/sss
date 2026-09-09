import { Injectable, computed, signal } from '@angular/core';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class AppInstallService {
  private deferred: InstallPrompt | null = null;
  private readonly displayMode = matchMedia('(display-mode: standalone)');
  private readonly dismissalKey = 'golden-batch-install-dismissed';
  readonly ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  readonly mobile = this.ios || /Android|Mobile/.test(navigator.userAgent);
  readonly installed = signal(this.displayMode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  readonly nativeAvailable = signal(false);
  readonly instructions = signal(false);
  readonly busy = signal(false);
  readonly dismissed = signal(this.wasDismissed());
  readonly visible = computed(() => this.mobile && window.isSecureContext && !this.installed() && !this.dismissed());

  constructor() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as InstallPrompt;
      this.nativeAvailable.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.deferred = null;
      this.nativeAvailable.set(false);
      this.instructions.set(false);
    });
    this.displayMode.addEventListener('change', () => this.installed.set(this.displayMode.matches));
  }

  async install() {
    if (this.busy()) return;
    const prompt = this.deferred;
    if (!prompt) {
      this.instructions.update((open) => !open);
      return;
    }
    this.busy.set(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') this.dismiss();
    } catch {
      this.instructions.set(true);
    } finally {
      this.deferred = null;
      this.nativeAvailable.set(false);
      this.busy.set(false);
    }
  }

  dismiss() {
    this.dismissed.set(true);
    try { localStorage.setItem(this.dismissalKey, String(Date.now())); } catch { /* Storage is optional. */ }
  }

  private wasDismissed() {
    try {
      const value = Number(localStorage.getItem(this.dismissalKey));
      return value > 0 && Date.now() - value < 7 * 24 * 60 * 60 * 1000;
    } catch { return false; }
  }
}
