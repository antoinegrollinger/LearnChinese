import { Routes, UrlMatcher, UrlSegment } from '@angular/router';
import { loggedIn, loggedOut } from './core/auth.guard';
import { Account } from './features/account/account';
import { Login } from './features/login/login';
import { Review } from './features/review/review';
import { Study } from './features/study/study';
import { Words } from './features/words/words';
import { PageTab, TabbedPage } from './shared/tabbed-page';

/** Matches "/prefix" and "/prefix/:name" with one route, so the page is kept when the parameter changes. */
function withOptionalParam(prefix: string, name: string): UrlMatcher {
  return (segments) => {
    if (!segments.length || segments[0].path !== prefix || segments.length > 2) return null;
    return { consumed: segments, posParams: segments[1] ? { [name]: segments[1] } : {} };
  };
}

/** Matches "" and ":name" with one route, except the segment of a sibling tab ("words", "word"). */
function optionalParamExcept(reserved: string, name: string): UrlMatcher {
  return (segments) => {
    if (segments.length > 1 || segments[0]?.path === reserved) return null;
    const posParams: Record<string, UrlSegment> = segments[0] ? { [name]: segments[0] } : {};
    return { consumed: segments, posParams };
  };
}

const STUDY_TABS: PageTab[] = [
  { name: 'Characters', icon: '字', path: '/study', count: 'characters' },
  { name: 'Words', icon: '词', path: '/study/words', count: 'words' },
];
const REVIEW_TABS: PageTab[] = [
  { name: 'Characters', icon: '字', path: '/review', count: 'characters' },
  { name: 'Words', icon: '词', path: '/review/words', count: 'words' },
];
const DASHBOARD_TABS: PageTab[] = [
  { name: 'Characters', icon: '字', path: '/dashboard', count: 'character-reviews' },
  { name: 'Words', icon: '词', path: '/dashboard/words', count: 'word-reviews' },
];
const FRIEND_TABS: PageTab[] = [
  { name: 'All', icon: '全', path: '/friends/:username' },
  { name: 'Characters', icon: '字', path: '/friends/:username/characters' },
  { name: 'Words', icon: '词', path: '/friends/:username/words' },
];
const ADD_TABS: PageTab[] = [
  { name: 'Character', icon: '字', path: '/add' },
  { name: 'Word', icon: '词', path: '/add/word' },
];

const pages: Routes = [
  // Study: a tab for your characters (/study, /study/:character), one for your words
  // (/study/words, /study/words/:word).
  {
    path: 'study',
    component: TabbedPage,
    data: { tabs: STUDY_TABS, label: 'Study' },
    children: [
      {
        matcher: withOptionalParam('words', 'word'),
        component: Words,
        title: 'Words · Study · Hanzi Workshop',
      },
      {
        matcher: optionalParamExcept('words', 'character'),
        component: Study,
        title: 'Characters · Study · Hanzi Workshop',
      },
    ],
  },
  // Add: a tab to add or edit a character (/add, /add/:character), one for words
  // (/add/word, /add/word/:word).
  {
    path: 'add',
    component: TabbedPage,
    data: { tabs: ADD_TABS, label: 'Add' },
    children: [
      // Loaded when first opened (keeps the first download small).
      {
        matcher: withOptionalParam('word', 'word'),
        loadComponent: () => import('./features/add/add-word').then((m) => m.AddWord),
        title: 'Word · Add · Hanzi Workshop',
      },
      {
        matcher: optionalParamExcept('word', 'character'),
        loadComponent: () => import('./features/add/add').then((m) => m.Add),
        title: 'Character · Add · Hanzi Workshop',
      },
    ],
  },
  // The words used to have their own page.
  { path: 'words', redirectTo: 'study/words' },
  { path: 'words/:word', redirectTo: 'study/words/:word' },
  // Review: a tab for your characters (/review), one for your words (/review/words).
  {
    path: 'review',
    component: TabbedPage,
    data: { tabs: REVIEW_TABS, label: 'Review' },
    children: [
      {
        path: 'words',
        component: Review,
        data: { kind: 'words' },
        title: 'Words · Review · Hanzi Workshop',
      },
      {
        path: '',
        component: Review,
        data: { kind: 'characters' },
        title: 'Characters · Review · Hanzi Workshop',
      },
    ],
  },
  // Loaded when first opened (keeps the first download small).
  // Dashboard: the reviews of your characters (/dashboard), of your words (/dashboard/words).
  {
    path: 'dashboard',
    component: TabbedPage,
    data: { tabs: DASHBOARD_TABS, label: 'Dashboard' },
    children: [
      {
        path: 'words',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
        data: { kind: 'words' },
        title: 'Words · Dashboard · Hanzi Workshop',
      },
      {
        path: '',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
        data: { kind: 'characters' },
        title: 'Characters · Dashboard · Hanzi Workshop',
      },
    ],
  },
  {
    path: 'friends',
    loadComponent: () => import('./features/friends/friends').then((m) => m.Friends),
    title: 'Friends · Hanzi Workshop',
  },
  // A friend: all their reviews (/friends/:username), or those of their characters or words.
  {
    path: 'friends/:username',
    component: TabbedPage,
    data: { tabs: FRIEND_TABS, label: 'Their reviews' },
    children: [
      {
        path: 'characters',
        loadComponent: () =>
          import('./features/friends/friend-profile').then((m) => m.FriendProfilePage),
        data: { kind: 'characters' },
        title: 'Characters · Friend · Hanzi Workshop',
      },
      {
        path: 'words',
        loadComponent: () =>
          import('./features/friends/friend-profile').then((m) => m.FriendProfilePage),
        data: { kind: 'words' },
        title: 'Words · Friend · Hanzi Workshop',
      },
      {
        path: '',
        loadComponent: () =>
          import('./features/friends/friend-profile').then((m) => m.FriendProfilePage),
        data: { kind: 'all' },
        title: 'Friend · Hanzi Workshop',
      },
    ],
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
