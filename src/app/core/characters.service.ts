import { Injectable } from '@angular/core';
import { ApiListStore } from './api-list.store';
import { CharacterEntry, cleanEntry } from './character.model';

export { errorMessage } from './api-list.store';

/** Your characters (data/characters.json). */
@Injectable({ providedIn: 'root' })
export class CharactersService extends ApiListStore<CharacterEntry> {
  constructor() {
    super('/api/characters', (c) => c.character, cleanEntry);
  }
}
