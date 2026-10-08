import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';

import { LEGAL_LABELS, LEGAL_TEXTS, type LegalText } from '../legal-texts';

const kinds: LegalText[] = ['terms', 'privacy'];
const languages = ['ro', 'en'] as const;
const cases = languages.flatMap((language) =>
  kinds.map((kind) => [language, kind] as const),
);

describe('the legal texts as data', () => {
  it.each(cases)(
    'the %s %s shows the version the API requires',
    (language, kind) => {
      const expected = kind === 'terms' ? TERMS_VERSION : PRIVACY_VERSION;

      expect(LEGAL_TEXTS[language][kind].version).toBe(expected);
    },
  );

  it.each(cases)(
    'the %s %s has no empty title, heading or paragraph',
    (language, kind) => {
      const { sections, title } = LEGAL_TEXTS[language][kind];

      expect(title.trim()).not.toBe('');
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        expect(section.heading.trim()).not.toBe('');
        expect(section.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of section.paragraphs)
          expect(paragraph.trim()).not.toBe('');
      }
    },
  );

  it.each(cases)(
    'the %s %s has no two sections with the same heading',
    (language, kind) => {
      const headings = LEGAL_TEXTS[language][kind].sections.map(
        (s) => s.heading,
      );

      expect(new Set(headings).size).toBe(headings.length);
    },
  );

  it.each(kinds)(
    'the %s holds as many sections and paragraphs in Romanian as in English',
    (kind) => {
      const shape = (language: 'ro' | 'en') =>
        LEGAL_TEXTS[language][kind].sections.map((s) => s.paragraphs.length);

      expect(shape('ro')).toEqual(shape('en'));
    },
  );

  it.each(cases)(
    'the %s %s holds no unfilled placeholder or raw markup',
    (language, kind) => {
      const all = JSON.stringify(LEGAL_TEXTS[language][kind]);

      expect(all).not.toMatch(/\{\{|\}\}|<[a-z/][^>]*>|undefined|\[object/i);
    },
  );

  it.each(languages)(
    'the %s draft notice and version label are not empty',
    (language) => {
      expect(LEGAL_LABELS[language].draft.trim()).not.toBe('');
      expect(LEGAL_LABELS[language].version.trim()).not.toBe('');
    },
  );

  it('keeps the Romanian text in Romanian and the English in English', () => {
    expect(LEGAL_TEXTS.ro.terms.title).not.toBe(LEGAL_TEXTS.en.terms.title);
    expect(LEGAL_TEXTS.ro.privacy.title).not.toBe(LEGAL_TEXTS.en.privacy.title);
    expect(LEGAL_TEXTS.ro.terms.title).not.toBe(LEGAL_TEXTS.ro.privacy.title);
  });
});
