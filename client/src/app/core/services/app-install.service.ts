import { Injectable, computed, signal } from '@angular/core';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class AppInstallService {
  private deferred: InstallPrompt | null = null;
  private readonly displayMode = matchMedia('(display-mode: standalone)');
  private promptAccepted = false;
  readonly ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  readonly mobile = this.ios || /Android|Mobile/.test(navigator.userAgent);
  readonly installed = signal(this.displayMode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  readonly nativeAvailable = signal(false);
  readonly instructions = signal(false);
  readonly busy = signal(false);
  // Installation is required for the mobile operations experience, so this
  // banner stays present until the browser confirms the app was installed.
  readonly visible = computed(() => this.mobile && window.isSecureContext && !this.installed());

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
      if (choice.outcome === 'accepted') {
        this.promptAccepted = true;
        this.installed.set(true);
        this.instructions.set(false);
      } else {
        // A browser can close its own native dialog. Keep our required banner
        // visible and explain how to install from the browser menu instead.
        this.instructions.set(true);
      }
    } catch {
      this.instructions.set(true);
    } finally {
      this.deferred = null;
      this.nativeAvailable.set(false);
      this.busy.set(false);
    }
  }
}
