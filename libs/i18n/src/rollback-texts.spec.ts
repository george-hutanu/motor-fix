import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Language = 'ro' | 'en';
type Texts = Record<string, unknown>;

// Read from the files, not through I18n.t, which falls back to Romanian and
// would hide a text missing in English.
const bundle = (area: string, language: Language): Texts =>
  JSON.parse(readFileSync(join(__dirname, area, `${language}.json`), 'utf8'));

const at = (texts: Texts, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node as Texts | undefined)?.[key], texts);

// The three lines a failed toggle shows when it puts the choice back.
// @traces 1315-FR-014
describe('the lines a failed toggle shows', () => {
  it.each([
    [
      'ro',
      'shell',
      'notifications.saveFailed',
      'Setarea nu a putut fi salvată',
    ],
    [
      'en',
      'shell',
      'notifications.saveFailed',
      'The setting could not be saved',
    ],
    [
      'ro',
      'shell',
      'bell.readFailed',
      'Notificarea nu a putut fi marcată ca citită.',
    ],
    [
      'en',
      'shell',
      'bell.readFailed',
      'The notification could not be marked as read.',
    ],
    ['ro', 'garage', 'prices.notSaved', 'Nu s‑a salvat. Încearcă din nou.'],
    ['en', 'garage', 'prices.notSaved', 'Not saved. Try again.'],
  ] as const)('%s %s.%s reads as before', (language, area, path, text) => {
    expect(at(bundle(area, language), path)).toBe(text);
  });
});
