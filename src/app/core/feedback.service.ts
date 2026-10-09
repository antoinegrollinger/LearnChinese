import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FeedbackMessage } from './feedback.model';

/** The About page's contact and bug report forms (POST /api/feedback, no login needed). */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);

  async send(message: FeedbackMessage): Promise<void> {
    await firstValueFrom(this.http.post('/api/feedback', message));
  }
}
