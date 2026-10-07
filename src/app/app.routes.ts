import { Routes, UrlMatcher } from '@angular/router';
import { Add } from './features/add/add';
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

export const routes: Routes = [
  {
    matcher: withOptionalParam('study', 'character'),
    component: Study,
    title: 'Study · Hanzi Workshop',
  },
  { path: 'review', component: Review, title: 'Review · Hanzi Workshop' },
  { matcher: withOptionalParam('add', 'character'), component: Add, title: 'Add · Hanzi Workshop' },
  {
    matcher: withOptionalParam('words', 'word'),
    component: Words,
    title: 'Words · Hanzi Workshop',
  },
  { path: '**', redirectTo: 'study' },
];
