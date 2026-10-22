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
  it('names the key of a voice 5 headline missing in Romanian', () => {
    const ro = clone(publicVoice('ro'));
    delete voice(ro, 5)['headline'];

    expect(fileProblems('public.voice', ro, publicVoice('en'))).toContain(
      'public.voice.v5.headline: missing in ro',
    );
  });

  // @traces 008-FR-007
  it('fails when feat2 appears in one language of voice 3 only', () => {
    const ro = clone(publicVoice('ro'));
    voice(ro, 3)['feat2'] = 'A doua linie';

    const problems = fileProblems('public.voice', ro, publicVoice('en'));

    expect(problems.some((p) => p.includes('v3.feat2'))).toBe(true);
  });
});
