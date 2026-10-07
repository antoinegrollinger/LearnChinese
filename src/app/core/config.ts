import { Role } from './character.model';

/* Character types and component roles. Add your own entries here:
 * the app picks them up automatically (filters, badges, colours, Add form). */

export interface CharacterType {
  name: string;
  chinese: string;
  description: string;
  color: string;
}

export const TYPES: Record<string, CharacterType> = {
  pictogram: {
    name: 'Pictogram',
    chinese: '象形 xiàngxíng',
    description: 'A stylised drawing of a concrete object.',
    color: '#2e8b57',
  },
  ideogram: {
    name: 'Ideogram',
    chinese: '指事 zhǐshì · 会意 huìyì',
    description:
      'Expresses an idea: an indicative sign (上, 本) or a combination of elements whose meanings add up (休 = person + tree).',
    color: '#8e44ad',
  },
  phonosemantic: {
    name: 'Phono-semantic',
    chinese: '形声 xíngshēng',
    description:
      'One part gives the meaning (semantic component), the other gives the sound (phonetic component). Over 80% of characters.',
    color: '#d35400',
  },
};

export const DEFAULT_TYPE = 'pictogram';

export const ROLES: Record<Role, { name: string; colors: string[] }> = {
  meaning: { name: 'Meaning (semantic)', colors: ['#d1495b', '#e8833a'] },
  sound: { name: 'Sound (phonetic)', colors: ['#2e86de', '#6c5ce7'] },
  other: { name: 'Other component', colors: ['#16a085', '#7f8c8d'] },
};

export const typeOf = (key?: string): CharacterType => TYPES[key ?? ''] ?? TYPES[DEFAULT_TYPE];
