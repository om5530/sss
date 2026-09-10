import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, merge, switchMap, timer } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AdminSessionService } from '../../../core/services/admin-session.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  protected readonly unreadEnquiries = signal<number | null>(null);
  protected readonly bakeryOpen = signal<boolean>(true);
  protected readonly mobileNavOpen = signal(false);
  protected auth = inject(AuthService);
  private router = inject(Router);
  private session = inject(AdminSessionService);
  constructor() {
    const destroy = inject(DestroyRef);
    this.router.events.pipe(takeUntilDestroyed(destroy)).subscribe(e => { if(e instanceof NavigationEnd) this.mobileNavOpen.set(false); });
    const admin = inject(AdminService);
    merge(timer(0, 30_000), admin.enquiryChanges).pipe(
      switchMap(() => admin.unreadEnquiries().pipe(catchError(() => EMPTY))),
      takeUntilDestroyed(destroy),
    ).subscribe((res) => this.unreadEnquiries.set(res.newCount));
    destroy.onDestroy(inject(AdminSessionService).start());
    const http = inject(HttpClient);
    let running = false;
    const dispatch = () => {
      if (running || !this.auth.isAuthenticated()) return;
      running = true;
      http.post(`${environment.apiUrl}/admin/notifications/dispatch`, {}).subscribe({
        next: () => { running = false; }, error: () => { running = false; },
      });
    };
    dispatch();
    const dispatchTimer = window.setInterval(dispatch, 30_000);
    destroy.onDestroy(() => clearInterval(dispatchTimer));
  }

  async signOut() {
    this.session.keepDraft();
    if (!await this.auth.logout()) return;
    this.router.navigateByUrl('/');
  }
}
