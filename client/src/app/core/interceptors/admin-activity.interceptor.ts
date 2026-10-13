import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { defer, finalize } from 'rxjs';
import { AdminRequestActivity } from '../services/admin-request-activity.service';
import { adminRequestKind } from '../utils/admin-request-state';

export const adminActivityInterceptor: HttpInterceptorFn = (req, next) => {
  const kind = adminRequestKind(req.url, req.method);
  if (!kind) return next(req);
  const activity = inject(AdminRequestActivity);
  return defer(() => {
    const finish = activity.begin(kind);
    // Include synchronous failures, errors and cancellation in cleanup.
    return defer(() => next(req)).pipe(finalize(finish));
  });
};
