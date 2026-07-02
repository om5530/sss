import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

// Surfaces a friendly toast for server/network failures. Components can still
// handle the rethrown error for inline validation messaging.
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 0) {
        toast.error('Cannot reach the server. Is the API running on :4000?');
      } else if (err.status >= 500) {
        toast.error(err.error?.message || 'Something went wrong on our end. Please try again.');
      }
      return throwError(() => err);
    }),
  );
};
