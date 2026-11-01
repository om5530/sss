import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SaasAccountState } from '../services/saas-account-state.service';
export const saasAccountInterceptor: HttpInterceptorFn = (req, next) => {
 if (!/\/saas\/(?:bakeries|invitations)(?:\/|$)/.test(req.url)) return next(req);
 const state = inject(SaasAccountState), account = state.account();
 const headers = account ? req.headers.delete('Authorization').set('X-Saas-Account-Id', account.id).set('X-Saas-Workspace', '1') : req.headers;
 return next(req.clone({ withCredentials: true, headers })).pipe(catchError((error: unknown) => { if (error instanceof HttpErrorResponse && (error.status === 401 || error.error?.details?.code === 'SAAS_ACCOUNT_CHANGED') && state.account()?.id === account?.id) state.account.set(null); return throwError(() => error); }));
};
