import { Injectable, computed } from '@angular/core';
import { ApiListStore } from './api-list.store';
import { ReviewSession, cleanReview } from './review.model';

/** Your completed review sessions (through the API, stored in the database). */
@Injectable({ providedIn: 'root' })
export class ReviewsService extends ApiListStore<ReviewSession> {
  constructor() {
    super('/api/reviews', (session) => String(session.id), cleanReview);
  }

  /** Newest first. */
  readonly sessions = computed(() =>
    [...this.list()].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
  );

  readonly last = computed<ReviewSession | undefined>(() => this.sessions()[0]);
}
