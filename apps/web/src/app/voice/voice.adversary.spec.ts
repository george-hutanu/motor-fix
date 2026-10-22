import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';

import { keysOf, type Slot, Voice } from './voice';

const i18nRoot = join(__dirname, '../../../../../libs/i18n/src');
const read = (area: string, language: string) =>
  JSON.parse(
    readFileSync(join(i18nRoot, area, `${language}.json`), 'utf8'),
  ) as Record<string, unknown>;

type Texts = Record<string, string>;
const publicVoices = (language: string) =>
  read('public', language)['voice'] as Record<string, Texts>;
const reviewVoices = (language: string) =>
  (read('driver', language)['review'] as { voices: Texts }).voices;

const VOICES = ['v1', 'v2', 'v3', 'v4', 'v5'];
const SLOTS: Slot[] = [
  'cta',
  'eyebrow',
  'feat',
  'garage',
  'headline',
  'list',
  'no',
  'noLabel',
  'parts',
  'review',
  'sub',
];

// Every voice text of one language, labelled for the failure message;
// a plural group gives one text per category.
type Nested = string | { [key: string]: Nested };
const labelled = (label: string, text: Nested): [string, string][] =>
  typeof text === 'string'
    ? [[label, text]]
    : Object.entries(text).flatMap(([key, t]) =>
        labelled(`${label}.${key}`, t),
      );
const allTexts = (language: string) => [
  ...labelled('public.voice', publicVoices(language)),
  ...labelled('driver.review.voices', reviewVoices(language)),
];

function lookup(language: string, key: string): string | undefined {
  const [area, ...path] = key.split('.');
  let node: unknown = read(area, language);
  for (const part of path) node = (node as Record<string, unknown>)?.[part];
  return typeof node === 'string' ? node : undefined;
}

function voiceOf(mark: string | null) {
  if (mark === null) delete document.documentElement.dataset['voice'];
  else document.documentElement.dataset['voice'] = mark;
  TestBed.resetTestingModule();
  return TestBed.inject(Voice);
}

afterEach(() => {
  delete document.documentElement.dataset['voice'];
});

// @traces 006-FR-001
describe('the translation files hold five complete voices', () => {
  it.each(['ro', 'en'])('%s has exactly the voices v1 to v5', (language) => {
    expect(Object.keys(publicVoices(language)).sort()).toEqual(VOICES);
    expect(Object.keys(reviewVoices(language)).sort()).toEqual(VOICES);
  });

  it.each(VOICES)('%s has the same keys in Romanian and English', (v) => {
    expect(Object.keys(publicVoices('ro')[v]).sort()).toEqual(
      Object.keys(publicVoices('en')[v]).sort(),
    );
  });

  it.each(['v3', 'v5'])(
    '%s has no second benefits line in either language',
    (v) => {
      expect(publicVoices('ro')[v]).not.toHaveProperty('feat2');
      expect(publicVoices('en')[v]).not.toHaveProperty('feat2');
    },
  );

  it.each(['v1', 'v2', 'v4'])(
    '%s has a second benefits line in both languages',
    (v) => {
      expect(publicVoices('ro')[v]['feat2']?.trim()).not.toBe('');
      expect(publicVoices('en')[v]['feat2']?.trim()).not.toBe('');
    },
  );

  it('uses the same placeholders in Romanian and English for every text', () => {
    const holes = (t: string) => (t.match(/\{[^}]*\}/g) ?? []).sort();
    const en = new Map(allTexts('en'));
    for (const [key, ro] of allTexts('ro'))
      expect([key, holes(ro)]).toEqual([
        key,
        // Romanian's "few" has no English group; it matches "other".
        holes(en.get(key) ?? en.get(key.replace(/\.few$/, '.other')) ?? ''),
      ]);
  });

  it('names the brand where the slot is about the brand, in both languages', () => {
    for (const language of ['ro', 'en'])
      for (const v of VOICES)
        for (const slot of ['list', 'no'])
          expect([language, v, slot, publicVoices(language)[v][slot]]).toEqual([
            language,
            v,
            slot,
            expect.stringContaining('{brand}'),
          ]);
  });
});

// @traces 006-FR-001
describe('how the voice texts are written', () => {
  it('joins Romanian words with a non-breaking hyphen, never a plain one', () => {
    const plain = allTexts('ro').filter(([, t]) => /\p{L}-\p{L}/u.test(t));

    expect(plain).toEqual([]);
  });

  it.each(['ro', 'en'])('writes every %s text in sentence case', (language) => {
    const wrong = allTexts(language).filter(([, t]) => {
      // A count opens its sentence with a number.
      const letters = t
        .replace(/\{brand\}/g, 'Brand')
        .replace(/^\{count\} \p{L}/u, '0 X');
      const first = /\p{L}/u.exec(letters)?.[0] ?? '';
      const shouting = /\p{Ll}/u.test(letters) === false;
      return first !== first.toUpperCase() || shouting;
    });

    expect(wrong).toEqual([]);
  });

  it.each(['ro', 'en'])(
    'has no empty, padded or doubly spaced %s text',
    (language) => {
      const wrong = allTexts(language).filter(
        ([, t]) => t.trim() !== t || t === '' || /\s{2,}/.test(t),
      );

      expect(wrong).toEqual([]);
    },
  );

  it('opens Romanian quotes low and never with English ones', () => {
    const wrong = allTexts('ro').filter(
      ([, t]) => t.includes('“') || t.includes('"'),
    );

    expect(wrong).toEqual([]);
  });

  it('never uses Romanian low quotes or straight quotes in English', () => {
    const wrong = allTexts('en').filter(
      ([, t]) => t.includes('„') || t.includes('"'),
    );

    expect(wrong).toEqual([]);
  });

  it('closes every Romanian quote it opens', () => {
    const wrong = allTexts('ro').filter(
      ([, t]) => (t.match(/„/g) ?? []).length !== (t.match(/”/g) ?? []).length,
    );

    expect(wrong).toEqual([]);
  });

  it('uses comma-below Ș and Ț in Romanian, never the cedilla forms', () => {
    const wrong = allTexts('ro').filter(([, t]) => /[ŞşŢţ]/.test(t));

    expect(wrong).toEqual([]);
  });

  it('says voice 4’s Home texts as the story’s example, once shown in capitals where the board does', () => {
    const four = publicVoices('ro')['v4'];
    const plainHyphen = (t: string) => t.replace(/‑/g, '-');

    expect(plainHyphen(four['eyebrow']).toUpperCase()).toBe(
      'FĂRĂ „LAS-O LA NOI ȘI VEDEM”',
    );
    expect(plainHyphen(four['cta']).toUpperCase()).toBe('GĂSEȘTE-L ACUM');
    expect(four['parts']).toBe('Ce face figuri?');
    expect(four['list'].replace('{brand}', 'BMW')).toBe(
      'Ei nu strâmbă din nas la BMW',
    );
    expect(four['garage']).toBe('Ai mâini bune? Să afle tot orașul.');
  });

  it('gives voice 5 the review title the story names', () => {
    expect(reviewVoices('ro')['v5']).toBe('Prețul a fost cel promis?');
  });

  it('gives voice 2 the short and full red-lamp labels the story names', () => {
    const two = publicVoices('ro')['v2'];

    expect(two['no'].replace('{brand}', 'BMW')).toBe('Nu lucrează pe BMW');
    expect(two['noLabel']).toBe('Nu lucrează pe');
  });
});

// @traces 006-FR-006
describe('keysOf', () => {
  it.each([1, 2, 3, 4, 5])(
    'points voice %i at keys that exist in both languages',
    (n) => {
      const keys = keysOf(n);

      expect(Object.keys(keys).sort()).toEqual([...SLOTS].sort());
      for (const language of ['ro', 'en'])
        for (const slot of SLOTS)
          expect([slot, lookup(language, keys[slot])]).toEqual([
            slot,
            expect.any(String),
          ]);
    },
  );

  it('gives each voice its own keys, never another voice’s', () => {
    for (const n of [1, 2, 3, 4, 5])
      for (const key of Object.values(keysOf(n)))
        expect(key).toMatch(new RegExp(`\\.v${n}(\\.|$)`));
  });

  it('returns the same keys when asked twice', () => {
    expect(keysOf(4)).toEqual(keysOf(4));
  });
});

// @traces 006-FR-006
describe('the Voice service', () => {
  it.each([1, 2, 3, 4, 5])('serves voice %i’s keys as its copy', (n) => {
    const voice = voiceOf(String(n));

    expect(voice.copy).toEqual(keysOf(n));
    for (const slot of SLOTS) expect(voice.key(slot)).toBe(keysOf(n)[slot]);
  });

  it.each([
    [1, 'public.voice.v1.feat2'],
    [2, 'public.voice.v2.feat2'],
    [3, null],
    [4, 'public.voice.v4.feat2'],
    [5, null],
  ])('voice %i has second benefits line %p', (n, expected) => {
    expect(voiceOf(String(n)).feat2).toBe(expected);
  });

  it.each([
    '3 ',
    '+3',
    '03',
    '3e0',
    '0x3',
    '٣',
    '３',
    '1,2',
    'null',
    'undefined',
  ])('treats the mark %p as no voice and speaks in voice 1', (mark) => {
    const voice = voiceOf(mark);

    expect(voice.voice).toBe(1);
    expect(voice.copy).toEqual(keysOf(1));
    expect(voice.feat2).toBe('public.voice.v1.feat2');
  });

  it('keeps one voice for every reader in the app, even after the mark changes', () => {
    const voice = voiceOf('5');
    document.documentElement.dataset['voice'] = '2';
    const again = TestBed.inject(Voice);

    expect(again).toBe(voice);
    expect(again.voice).toBe(5);
    expect(again.feat2).toBeNull();
  });
});
