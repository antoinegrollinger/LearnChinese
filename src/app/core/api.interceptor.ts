import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService, storedToken } from './auth.service';

/** Base URL of the API, from public/config.json ("" = same server as the app). */
export const API_URL = new InjectionToken<string>('API_URL');

/**
 * Sends /api/... requests to the configured API URL with the session token
 * ("Authorization: Bearer …"). When the server says the session is no longer valid, goes back to
 * the login screen.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const auth = inject(AuthService);
  const token = storedToken();
  const request = req.clone({
    url: inject(API_URL) + req.url,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return next(request).pipe(
    catchError((err) => {
      const isAuthRoute = req.url.startsWith('/api/auth/');
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthRoute) auth.expired();
      return throwError(() => err);
    }),
  );
};
