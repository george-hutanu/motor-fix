import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fileProblems } from './check';
import type { Texts } from './files';

type Language = 'ro' | 'en';

const file = (area: string, language: Language): Texts =>
  JSON.parse(
    readFileSync(join(__dirname, area, `${language}.json`), 'utf8'),
  ) as Texts;

const publicVoice = (language: Language) =>
  file('public', language)['voice'] as Texts;
const reviewVoices = (language: Language) =>
  (file('driver', language)['review'] as Texts)['voices'] as Texts;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const voice = (texts: Texts, n: number) => texts[`v${n}`] as Texts;

describe('the voice texts as the file check reads them', () => {
  // @traces 008-FR-001
  it('carries feat2 in voices 1, 2 and 4 and in neither language for 3 and 5', () => {
    for (const language of ['ro', 'en'] as const) {
      const texts = publicVoice(language);
      for (const n of [1, 2, 4])
        expect(typeof voice(texts, n)['feat2']).toBe('string');
      for (const n of [3, 5])
        expect(voice(texts, n)).not.toHaveProperty('feat2');
    }
  });

  // @traces 008-FR-007
  it('names the key of a voice 3 count text missing in English', () => {
    const en = clone(publicVoice('en'));
    delete voice(en, 3)['count'];

    const problems = fileProblems('public.voice', publicVoice('ro'), en);

    expect(problems.some((p) => p.includes('v3.count'))).toBe(true);
  });

  // @traces 008-FR-007
  it('names the key of a voice 5 headline missing in Romanian', () => {
    const ro = clone(publicVoice('ro'));
    delete voice(ro, 5)['headline'];

    expect(fileProblems('public.voice', ro, publicVoice('en'))).toContain(
      'public.voice.v5.headline: missing in ro',
    );
  });

  // @traces 008-FR-007
  it('names the key of a whitespace-only voice text', () => {
    const en = clone(publicVoice('en'));
    voice(en, 2)['cta'] = '  \t ';

    const problems = fileProblems('public.voice', publicVoice('ro'), en);

    expect(problems.some((p) => p.includes('v2.cta'))).toBe(true);
  });

  // @traces 008-FR-007
  it('names the key of an empty review drawer title in English', () => {
    const en = clone(reviewVoices('en'));
    en['v4'] = '';

    expect(
      fileProblems('driver.review.voices', reviewVoices('ro'), en),
    ).toContain('driver.review.voices.v4: empty in en');
  });

  // @traces 008-FR-007
  it('fails when feat2 appears in one language of voice 3 only', () => {
    const ro = clone(publicVoice('ro'));
    voice(ro, 3)['feat2'] = 'A doua linie';

    const problems = fileProblems('public.voice', ro, publicVoice('en'));

    expect(problems.some((p) => p.includes('v3.feat2'))).toBe(true);
  });

  // @traces 008-FR-007
  it('names the key when a voice 3 plural category is missing in English', () => {
    const en = clone(publicVoice('en'));
    const count = voice(en, 3)['count'];
    if (typeof count === 'string') throw new Error('count is not a group');
    const category = Object.keys(count).find((k) => k !== 'other') as string;
    delete count[category];

    const problems = fileProblems('public.voice', publicVoice('ro'), en);

    expect(problems.some((p) => p.includes('v3.count'))).toBe(true);
  });
});
