import { Component, HostListener, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { MotionService } from '../../../core/services/motion.service';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class Navbar {
  protected auth = inject(AuthService);
  protected cart = inject(CartService);
  private motion = inject(MotionService);
  private router = inject(Router);

  protected readonly scrolled = signal(false);
  protected readonly menuOpen = signal(false);
  /** Briefly true whenever the cart count changes — drives the badge pop. */
  protected readonly bump = signal(false);

  private bumpTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCount = 0;

  constructor() {
    effect(() => {
      const count = this.cart.count();
      if (count !== this.lastCount && this.lastCount !== 0 || (this.lastCount === 0 && count > 0)) {
        this.bump.set(true);
        clearTimeout(this.bumpTimer);
        this.bumpTimer = setTimeout(() => this.bump.set(false), 500);
      }
      this.lastCount = count;
    });

    // Release the scroll lock on ANY navigation — back/forward and programmatic
    // redirects (login returnUrl, checkout → order-success) never click a link,
    // and a leaked lock leaves the whole app unscrollable.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.closeMenu());
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 24);
  }

  /** The sheet only exists ≤860px — growing past that while open would strand the lock. */
  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth > 860) this.closeMenu();
  }

  toggleMenu() {
    this.menuOpen.update((v) => !v);
    this.syncScrollLock();
  }

  closeMenu() {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.syncScrollLock();
  }

  private syncScrollLock() {
    const open = this.menuOpen();
    document.body.style.overflow = open ? 'hidden' : '';
    this.motion.lock(open);
  }
}
