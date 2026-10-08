import { Injectable } from '@angular/core';
import { ApiListStore } from './api-list.store';
import { CharacterEntry, cleanEntry } from './character.model';

export { errorMessage } from './api-list.store';

/** Your characters (through the API, stored in the database). */
@Injectable({ providedIn: 'root' })
export class CharactersService extends ApiListStore<CharacterEntry> {
  constructor() {
    super('/api/characters', (c) => c.character, cleanEntry);
  }
}
