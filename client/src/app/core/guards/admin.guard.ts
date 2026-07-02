import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

// Client-side convenience only — every admin API is role-gated on the server
// (AS-1.2). Non-admins are quietly returned home with no hint of what exists.
export const adminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (!auth.isAuthenticated()) {
    toast.info('Please sign in to continue.');
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.user()?.role !== 'admin') {
    return router.createUrlTree(['/']);
  }
  return true;
};
