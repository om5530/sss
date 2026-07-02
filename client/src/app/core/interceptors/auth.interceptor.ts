import { HttpInterceptorFn } from '@angular/common/http';

// Attaches the bearer token and sends cookies so the session is recognised
// whether the server reads the header or the httpOnly cookie.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('bc_token');
  return next(
    req.clone({
      withCredentials: true,
      setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
};
