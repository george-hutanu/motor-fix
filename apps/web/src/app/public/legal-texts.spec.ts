import { LEGAL_LABELS, LEGAL_TEXTS, type LegalText } from './legal-texts';

const languages = ['ro', 'en'] as const;

const whole = (language: 'ro' | 'en', kind: LegalText) =>
  LEGAL_TEXTS[language][kind].sections
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');

// The contact route of the texts: writing from the account.
const CONTACT = { en: /from your account/, ro: /din contul tău/ } as const;

describe('the final legal texts', () => {
  // @traces 243-FR-001
  it('no text or label says it is a draft or pending review', () => {
    const all = JSON.stringify({ LEGAL_LABELS, LEGAL_TEXTS });

    expect(all).not.toMatch(/provizoriu|draft|pending legal|revizuire/i);
  });

  // @traces 243-FR-007
  it.each(languages)('the %s terms of use have twelve sections', (language) => {
    expect(LEGAL_TEXTS[language].terms.sections).toHaveLength(12);
  });

  // @traces 243-FR-007 243-FR-011
  it.each([
    ['en', [/18/, /independent/i, /free/i, /Romanian law/i, /appeal/i]],
    ['ro', [/18/, /independente/i, /gratuit/i, /legea român/i, /contest/i]],
  ] as const)(
    'the %s terms cover age, garages, money, law and appeals',
    (language, facts) => {
      const text = whole(language, 'terms');
      for (const fact of facts) expect(text).toMatch(fact);
      expect(text).toMatch(CONTACT[language]);
    },
  );

  // @traces 243-FR-002 243-FR-003 243-FR-004 243-FR-005 243-FR-006 243-FR-014 243-FR-011
  it.each([
    [
      'en',
      [
        /number plate/i,
        /ANSPDCP/,
        /legitimate interest/i,
        /5 years/,
        /90 days/,
        /60 seconds/,
        /15 minutes/,
        /1 hour/,
        /standard contractual clauses/i,
        /cookie settings/i,
      ],
    ],
    [
      'ro',
      [
        /număr(ul)? de înmatriculare/i,
        /ANSPDCP/,
        /interes(ul nostru)? legitim/i,
        /5 ani/,
        /90 de zile/,
        /60 de secunde/,
        /15 minute/,
        /o oră/,
        /clauzele contractuale standard/i,
        /Setări cookie/,
      ],
    ],
  ] as const)(
    'the %s privacy notice has its eleven sections, providers, periods and rights',
    (language, facts) => {
      expect(LEGAL_TEXTS[language].privacy.sections).toHaveLength(11);
      const text = whole(language, 'privacy');
      expect(text).toContain('mf_refresh');
      for (const fact of facts) expect(text).toMatch(fact);
      expect(text).toMatch(CONTACT[language]);
    },
  );
});
