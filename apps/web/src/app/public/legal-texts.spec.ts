import { LEGAL_LABELS, LEGAL_TEXTS, type LegalText } from './legal-texts';

const languages = ['ro', 'en'] as const;

const whole = (language: 'ro' | 'en', kind: LegalText) =>
  LEGAL_TEXTS[language][kind].sections
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');

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
        /WhatsApp sign-in codes/,
        /live page.*in memory only/,
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
        /codurile de autentificare prin WhatsApp/,
        /pagina live.*doar în memorie/,
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

describe('the operator and how to reach it', () => {
  const OPERATOR = [
    'HUȚANU GEORGE-DRAGOȘ PERSOANĂ FIZICĂ AUTORIZATĂ',
    '55178146',
    'ROONRC.F2026034954005',
    'București, Sector 1, Bd. Bucureștii Noi nr. 136, parter, ap. 5',
    'hutanugeorge40@gmail.com',
  ];
  const REGISTER = {
    en: /trade register number F2026034954005/i,
    ro: /Registrul Comerțului[^.]*F2026034954005/,
  } as const;

  const first = (language: 'ro' | 'en') =>
    LEGAL_TEXTS[language].privacy.sections[0]!.paragraphs.join('\n');
  const contact = (language: 'ro' | 'en') =>
    LEGAL_TEXTS[language].terms.sections.at(-1)!.paragraphs.join('\n');

  // @traces 1203-FR-001 1203-FR-002
  it.each(languages)(
    'the %s privacy notice names the operator as controller and its e-mail in the first section',
    (language) => {
      const text = first(language);
      for (const fact of OPERATOR) expect(text).toContain(fact);
      expect(text).toMatch(REGISTER[language]);
      expect(text).toMatch(language === 'en' ? /controller/ : /operator/);
    },
  );

  // @traces 1203-FR-002
  it.each([
    ['en', /no account is needed/i, /from your account/],
    ['ro', /nu ai nevoie de cont/i, /din contul tău/],
  ] as const)(
    'the %s privacy notice takes data requests by e-mail without an account and still from the account',
    (language, noAccount, fromAccount) => {
      const text = first(language);
      expect(text).toMatch(noAccount);
      expect(text).toMatch(fromAccount);
    },
  );

  // @traces 1203-FR-002 1203-FR-003
  it.each([
    ['en', /once the company is set up/i, /create one and write/i],
    ['ro', /după înființarea firmei/i, /îți creezi unul și ne scrii/i],
  ] as const)(
    'the %s privacy notice no longer promises later details or asks for an account to write',
    (language, promise, createAccount) => {
      const text = whole(language, 'privacy');
      expect(text).not.toMatch(promise);
      expect(text).not.toMatch(createAccount);
    },
  );

  // @traces 1203-FR-004
  it.each([
    ['en', /Romanian law/],
    ['ro', /legea română/],
  ] as const)(
    'the %s terms name the same operator and e-mail under the governing law',
    (language, law) => {
      const text = contact(language);
      for (const fact of OPERATOR) expect(text).toContain(fact);
      expect(text).toMatch(REGISTER[language]);
      expect(text).toMatch(law);
      expect(text).toMatch(CONTACT[language]);
    },
  );

  // @traces 1203-FR-010
  it.each(languages)(
    'the %s operator details add no other address, phone number or officer',
    (language) => {
      const text = `${first(language)}\n${contact(language)}`;
      expect(text.match(/[\w.]+@[\w.]+/g)).toEqual([
        'hutanugeorge40@gmail.com',
        'hutanugeorge40@gmail.com',
      ]);
      expect(text).not.toMatch(
        /\+40|\b0\d{9}\b|DPO|data protection officer|responsabil/i,
      );
    },
  );

  // @traces 1203-FR-008
  it('no text uses a cedilla where Romanian takes a comma below', () => {
    expect(JSON.stringify(LEGAL_TEXTS)).not.toMatch(/[ŞşŢţ]/);
  });
});
