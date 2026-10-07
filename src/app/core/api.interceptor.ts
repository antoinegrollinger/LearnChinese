import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

/** Base URL of the API, from public/config.json ("" = same server as the app). */
export const API_URL = new InjectionToken<string>('API_URL');

const PASSWORD_KEY = 'hanzi-workshop-password';

function storedPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

function storePassword(password: string | null): void {
  try {
    if (password) localStorage.setItem(PASSWORD_KEY, password);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {}
}

/** HTTP Basic auth header (any user name), UTF-8 safe. */
function basicAuth(password: string): string {
  const bytes = new TextEncoder().encode(':' + password);
  return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

/**
 * Sends /api/... requests to the configured API URL. When the API is on another domain, the browser
 * doesn't ask for the password itself, so this asks for it (once, then it is kept in localStorage).
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(API_URL);
  if (!apiUrl || !req.url.startsWith('/api/')) return next(req);

  const send = (password: string | null): ReturnType<typeof next> => {
    let request: HttpRequest<unknown> = req.clone({ url: apiUrl + req.url });
    if (password) request = request.clone({ setHeaders: { Authorization: basicAuth(password) } });
    return next(request);
  };

  return send(storedPassword()).pipe(
    catchError((err) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      const password = prompt('Password for Hanzi Workshop:');
      storePassword(password);
      return password ? send(password) : throwError(() => err);
    }),
  );
};
