import { Routes, UrlMatcher, UrlSegment } from '@angular/router';
import { anyone, loggedIn, loggedOut } from './core/auth.guard';
import { Account } from './features/account/account';
import { Login } from './features/login/login';
import { Study } from './features/study/study/study';
import { Words } from './features/words/words';
import { PageTab, TabbedPage } from './shared/tabbed-page/tabbed-page';

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
  { name: 'Characters', icon: '字', path: '/training', count: 'characters' },
  { name: 'Words', icon: '词', path: '/training/words', count: 'words' },
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
const PAPER_TABS: PageTab[] = [
  { name: 'Practice sheets', icon: '练', path: '/paper' },
  { name: 'Export learning material', icon: '印', path: '/paper/export' },
];
const ADD_TABS: PageTab[] = [
  { name: 'Character', icon: '字', path: '/add' },
  { name: 'Word', icon: '词', path: '/add/word' },
];

const pages: Routes = [
  // My 汉字 and words (Study): a tab for your characters (/study, /study/:character), one for your words
  // (/study/words, /study/words/:word).
  {
    path: 'study',
    component: TabbedPage,
    data: { tabs: STUDY_TABS, label: 'My 汉字 and words', addButton: true },
    children: [
      {
        matcher: withOptionalParam('words', 'word'),
        component: Words,
        title: 'Words · My 汉字 and words · Hanzi Workshop',
      },
      {
        matcher: optionalParamExcept('words', 'character'),
        component: Study,
        title: 'Characters · My 汉字 and words · Hanzi Workshop',
      },
    ],
  },
  // Add: a tab to add or edit a character (/add, /add/:character), one for words
  // (/add/word, /add/word/:word).
  {
    path: 'add',
    component: TabbedPage,
    data: { tabs: ADD_TABS, label: 'Add a 汉字/Word' },
    children: [
      // Loaded when first opened (keeps the first download small).
      {
        matcher: withOptionalParam('word', 'word'),
        loadComponent: () => import('./features/add/add-word/add-word').then((m) => m.AddWord),
        title: 'Word · Add a 汉字/Word · Hanzi Workshop',
      },
      {
        matcher: optionalParamExcept('word', 'character'),
        loadComponent: () => import('./features/add/add/add').then((m) => m.Add),
        title: 'Character · Add a 汉字/Word · Hanzi Workshop',
      },
    ],
  },
  // The words used to have their own page.
  { path: 'words', redirectTo: 'study/words' },
  { path: 'words/:word', redirectTo: 'study/words/:word' },
  // Training session: a tab for your characters (/training), one for your words
  // (/training/words). It used to be called Review (/review).
  { path: 'review', redirectTo: 'training' },
  { path: 'review/words', redirectTo: 'training/words' },
  {
    path: 'training',
    component: TabbedPage,
    data: { tabs: REVIEW_TABS, label: 'Training session' },
    children: [
      // Loaded when first opened (keeps the first download small).
      {
        path: 'words',
        loadComponent: () => import('./features/review/review').then((m) => m.Review),
        data: { kind: 'words' },
        title: 'Words · Training session · Hanzi Workshop',
      },
      {
        path: '',
        loadComponent: () => import('./features/review/review').then((m) => m.Review),
        data: { kind: 'characters' },
        title: 'Characters · Training session · Hanzi Workshop',
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
  // Train on paper: printable practice sheets (/paper) and your learning material (/paper/export),
  // as PDF.
  {
    path: 'paper',
    component: TabbedPage,
    data: { tabs: PAPER_TABS, label: 'Train on paper' },
    children: [
      {
        path: 'export',
        loadComponent: () => import('./features/paper/export/export').then((m) => m.LearningExport),
        title: 'Export learning material · Train on paper · Hanzi Workshop',
      },
      {
        path: '',
        loadComponent: () => import('./features/paper/paper/paper').then((m) => m.Paper),
        title: 'Practice sheets · Train on paper · Hanzi Workshop',
      },
    ],
  },
  {
    path: 'friends',
    loadComponent: () => import('./features/friends/friends/friends').then((m) => m.Friends),
    title: 'Friends · Hanzi Workshop',
  },
  // A friend: all their reviews (/friends/:username), or those of their characters or words.
  {
    path: 'friends/:username',
    component: TabbedPage,
    data: { tabs: FRIEND_TABS, label: 'Their training sessions' },
    children: [
      {
        path: 'characters',
        loadComponent: () =>
          import('./features/friends/friend-profile/friend-profile').then(
            (m) => m.FriendProfilePage,
          ),
        data: { kind: 'characters' },
        title: 'Characters · Friend · Hanzi Workshop',
      },
      {
        path: 'words',
        loadComponent: () =>
          import('./features/friends/friend-profile/friend-profile').then(
            (m) => m.FriendProfilePage,
          ),
        data: { kind: 'words' },
        title: 'Words · Friend · Hanzi Workshop',
      },
      {
        path: '',
        loadComponent: () =>
          import('./features/friends/friend-profile/friend-profile').then(
            (m) => m.FriendProfilePage,
          ),
        data: { kind: 'all' },
        title: 'Friend · Hanzi Workshop',
      },
    ],
  },
  {
    path: 'communities',
    loadComponent: () =>
      import('./features/communities/communities/communities').then((m) => m.Communities),
    title: 'Communities · Hanzi Workshop',
  },
  {
    path: 'communities/:name',
    loadComponent: () =>
      import('./features/communities/community/community').then((m) => m.CommunityPage),
    title: 'Community · Hanzi Workshop',
  },
  { path: 'account', component: Account, title: 'Account · Hanzi Workshop' },
];

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [loggedOut], title: 'Log in · Hanzi Workshop' },
  // For everyone, logged in or not (contact and bug report forms).
  {
    path: 'about',
    canActivate: [anyone],
    loadComponent: () => import('./features/about/about').then((m) => m.About),
    title: 'About · Hanzi Workshop',
  },
  // Everything else needs a login.
  {
    path: '',
    canActivateChild: [loggedIn],
    children: [...pages, { path: '**', redirectTo: 'study' }],
  },
];
