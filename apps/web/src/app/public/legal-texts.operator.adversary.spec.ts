import { LEGAL_TEXTS, type LegalText } from './legal-texts';

const languages = ['ro', 'en'] as const;
const kinds = ['terms', 'privacy'] as const;

const EMAIL = 'hutanugeorge40@gmail.com';

const operatorSection = (language: 'ro' | 'en', kind: LegalText) => {
  const { sections } = LEGAL_TEXTS[language][kind];
  return kind === 'privacy' ? sections[0]! : sections.at(-1)!;
};
const whole = (language: 'ro' | 'en', kind: LegalText) =>
  LEGAL_TEXTS[language][kind].sections
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');

describe.each(languages)('the operator in the %s texts', (language) => {
  // @traces 1203-FR-010
  it.each(kinds)('the %s names the e-mail address exactly once', (kind) => {
    expect(whole(language, kind).split(EMAIL)).toHaveLength(2);
  });

  // @traces 1203-FR-010
  it.each(kinds)(
    'the %s names the operator only in its contact section',
    (kind) => {
      const named = LEGAL_TEXTS[language][kind].sections.filter((s) =>
        s.paragraphs.join('\n').includes('55178146'),
      );

      expect(named).toEqual([operatorSection(language, kind)]);
    },
  );
});

// @traces 1203-FR-009
it.each(kinds)(
  'the %s holds the operator in the same paragraph in both languages',
  (kind) => {
    const index = (language: 'ro' | 'en') =>
      operatorSection(language, kind).paragraphs.findIndex((p) =>
        p.includes('55178146'),
      );

    expect(index('en')).toBeGreaterThanOrEqual(0);
    expect(index('ro')).toBe(index('en'));
  },
);
