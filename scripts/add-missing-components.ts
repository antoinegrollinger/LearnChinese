/* Adds an entry for every component used by your characters that is not in data/characters.json yet.
 * Each new entry is filled from the dictionary (like the Add page) and placed just before the first
 * character that uses it, so components come first when you study the list.
 *
 *   npm run add-components                  add the missing components
 *   npm run add-components -- --dry-run     only show what would be added
 *   npm run add-components -- --recursive   also add the components of the new entries, and so on
 */
import { CharacterEntry, CharacterPart } from '../src/app/core/character.model.ts';
import {
  DICTIONARY_URL,
  Dictionary,
  FREQUENCY_URL,
  HskWord,
  WORDS_URL,
  buildDictionary,
  entryFromDictionary,
} from '../src/app/core/dictionary.ts';
import { readCharacters, writeCharacters } from '../server/data-files.ts';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const recursive = args.has('--recursive');

async function download(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/** New entry for a component, from the dictionary; falls back to what the parent character says. */
function entryFor(part: CharacterPart, dict: Dictionary, list: CharacterEntry[]): CharacterEntry {
  const found = dict.byCharacter.get(part.character);
  const entry = found ? entryFromDictionary(dict, found) : { character: part.character };
  entry.pinyin ||= part.pinyin;
  entry.meaning ||= part.meaning;
  // Its own components: reuse your data for the ones you already know.
  entry.components = entry.components?.map((k) => {
    const known = list.find((c) => c.character === k.character);
    return known
      ? { ...k, pinyin: known.pinyin ?? k.pinyin, meaning: known.meaning ?? k.meaning }
      : k;
  });
  return entry;
}

console.log('Downloading the dictionary…');
const [dictText, frequencies, words] = await Promise.all([
  download(DICTIONARY_URL),
  download(FREQUENCY_URL).catch(() => ''),
  download(WORDS_URL)
    .then((text) => JSON.parse(text) as HskWord[])
    .catch(() => [] as HskWord[]),
]);
const dict = buildDictionary(dictText, frequencies, words);

const list = await readCharacters();
const added: { entry: CharacterEntry; usedBy: string }[] = [];
let toCheck = [...list];

while (toCheck.length) {
  const newEntries: CharacterEntry[] = [];
  for (const character of toCheck) {
    for (const part of character.components ?? []) {
      if (part.character === character.character) continue; // base character used as its own component
      if (list.some((c) => c.character === part.character)) continue;
      const entry = entryFor(part, dict, list);
      list.splice(list.indexOf(character), 0, entry);
      newEntries.push(entry);
      added.push({ entry, usedBy: character.character });
    }
  }
  toCheck = recursive ? newEntries : [];
}

if (!added.length) {
  console.log('Nothing to add: every component is already in data/characters.json.');
} else {
  for (const { entry, usedBy } of added) {
    const parts = entry.components?.map((k) => k.character).join(' + ');
    console.log(
      `  ${entry.character}  ${entry.pinyin ?? ''}  ${entry.meaning ?? ''}` +
        `  [${entry.type || 'type unknown'}${parts ? ': ' + parts : ''}]  ← used by ${usedBy}`,
    );
  }
  if (dryRun) {
    console.log(`\n${added.length} character(s) would be added (dry run, nothing written).`);
  } else {
    await writeCharacters(list);
    console.log(
      `\nAdded ${added.length} character(s) to data/characters.json (previous version in characters.backup.json).` +
        '\nReload the app page to see them.',
    );
  }
}
