import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Pages of the app: only when logged in, otherwise to the login screen (and back afterwards). */
export const loggedIn: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  if (await inject(AuthService).restore()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Pages for everyone (About): the saved session is restored first, so they know who you are. */
export const anyone: CanActivateFn = async () => {
  await inject(AuthService).restore();
  return true;
};

/** The login screen: skipped when already logged in. */
export const loggedOut: CanActivateFn = async () => {
  const router = inject(Router);
  return (await inject(AuthService).restore()) ? router.createUrlTree(['/study']) : true;
};
