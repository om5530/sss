import { Injectable, signal } from '@angular/core';

type AdminTheme = 'dark' | 'light';
const THEME_KEY = 'gb_admin_theme';

@Injectable({ providedIn: 'root' })
export class AdminThemeService {
  readonly theme = signal<AdminTheme>(this.readPreference());
  private admin = location.pathname.startsWith('/admin');

  constructor() {
    this.apply();
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_KEY) {
        this.theme.set(this.readPreference());
        this.apply();
      }
    });
  }

  toggle() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Keep the choice for this visit if storage is blocked. */ }
    this.apply();
  }

  setAdminArea(admin: boolean) {
    this.admin = admin;
    this.apply();
  }

  private readPreference(): AdminTheme {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  }

  private apply() {
    if (this.admin) document.documentElement.dataset['adminTheme'] = this.theme();
    else delete document.documentElement.dataset['adminTheme'];
    let lock = document.querySelector<HTMLMetaElement>('meta[name="darkreader-lock"]');
    if (this.admin && !lock) {
      lock = document.createElement('meta');
      lock.name = 'darkreader-lock';
      document.head.appendChild(lock);
    } else if (!this.admin) lock?.remove();
  }
}
