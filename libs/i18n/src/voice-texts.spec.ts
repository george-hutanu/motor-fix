import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fileProblems } from './check';
import { flatten, type Texts } from './files';

type Language = 'ro' | 'en';

// Read from the files, not through I18n.t, which falls back to Romanian and
// would hide a text missing in English.
const file = (area: string, language: Language): Texts =>
  JSON.parse(
    readFileSync(join(__dirname, area, `${language}.json`), 'utf8'),
  ) as Texts;

const voices = (language: Language): Record<string, Texts> => ({
  'driver.review.voices': (file('driver', language)['review'] as Texts)[
    'voices'
  ] as Texts,
  'public.voice': file('public', language)['voice'] as Texts,
});

// Words of the other language that never belong in a voice text.
const FOREIGN: Record<Language, string[]> = {
  en: ['și', 'service-uri', 'mașină', 'mecanic'],
  ro: ['the', 'your', 'garage', 'mechanic'],
};

const carries = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}-])${word}(?![\\p{L}-])`, 'iu').test(
    text.replace(/‑/g, '-'),
  );

describe('the texts of the five voices', () => {
  // @traces 008-FR-001
  // @traces 008-FR-007
  it('are in Romanian and in English alike, none empty', () => {
    const ro = voices('ro');
    const en = voices('en');

    const problems = Object.keys(ro).flatMap((area) =>
      fileProblems(area, ro[area], en[area]),
    );

    expect(problems).toEqual([]);
  });

  // @traces 008-FR-007
  // @traces 008-FR-010
  it('carry no word of the other language', () => {
    const mixed = (['ro', 'en'] as const).flatMap((language) =>
      Object.entries(voices(language)).flatMap(([area, subtree]) =>
        Object.entries(flatten(area, subtree)).flatMap(([key, text]) =>
          FOREIGN[language]
            .filter((word) => carries(text, word))
            .map((word) => `${key}: "${word}" in ${language}`),
        ),
      ),
    );

    expect(mixed).toEqual([]);
  });

  // @traces 008-FR-007
  it('finds a word of the other language as a whole word only', () => {
    expect(carries('20 de service‑uri', 'service-uri')).toBe(true);
    expect(carries('Your BMW', 'your')).toBe(true);
    expect(carries('Mecanicul tău', 'mecanic')).toBe(false);
    expect(carries('theory', 'the')).toBe(false);
  });
});
