import { Routes, UrlMatcher } from '@angular/router';
import { loggedIn, loggedOut } from './core/auth.guard';
import { Account } from './features/account/account';
import { Add } from './features/add/add';
import { Login } from './features/login/login';
import { Review } from './features/review/review';
import { Study } from './features/study/study';
import { Words } from './features/words/words';

/** Matches "/prefix" and "/prefix/:name" with one route, so the page is kept when the parameter changes. */
function withOptionalParam(prefix: string, name: string): UrlMatcher {
  return (segments) => {
    if (!segments.length || segments[0].path !== prefix || segments.length > 2) return null;
    return { consumed: segments, posParams: segments[1] ? { [name]: segments[1] } : {} };
  };
}

const pages: Routes = [
  {
    matcher: withOptionalParam('study', 'character'),
    component: Study,
    title: 'Study · Hanzi Workshop',
  },
  { path: 'review', component: Review, title: 'Review · Hanzi Workshop' },
  // Loaded when first opened (keeps the first download small).
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard · Hanzi Workshop',
  },
  { matcher: withOptionalParam('add', 'character'), component: Add, title: 'Add · Hanzi Workshop' },
  {
    matcher: withOptionalParam('words', 'word'),
    component: Words,
    title: 'Words · Hanzi Workshop',
  },
  {
    path: 'friends',
    loadComponent: () => import('./features/friends/friends').then((m) => m.Friends),
    title: 'Friends · Hanzi Workshop',
  },
  {
    path: 'friends/:username',
    loadComponent: () =>
      import('./features/friends/friend-profile').then((m) => m.FriendProfilePage),
    title: 'Friend · Hanzi Workshop',
  },
  {
    path: 'communities',
    loadComponent: () => import('./features/communities/communities').then((m) => m.Communities),
    title: 'Communities · Hanzi Workshop',
  },
  {
    path: 'communities/:name',
    loadComponent: () => import('./features/communities/community').then((m) => m.CommunityPage),
    title: 'Community · Hanzi Workshop',
  },
  { path: 'account', component: Account, title: 'Account · Hanzi Workshop' },
];

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [loggedOut], title: 'Log in · Hanzi Workshop' },
  // Everything else needs a login.
  {
    path: '',
    canActivateChild: [loggedIn],
    children: [...pages, { path: '**', redirectTo: 'study' }],
  },
];
