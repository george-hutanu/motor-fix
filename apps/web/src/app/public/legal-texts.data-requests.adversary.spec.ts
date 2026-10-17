import { LEGAL_TEXTS, type LegalText } from './legal-texts';

type Language = 'ro' | 'en';
const languages = ['ro', 'en'] as const;
const kinds = ['terms', 'privacy'] as const;

const EMAIL = 'hutanugeorge40@gmail.com';
const ABOVE = {
  en: /the e-mail address above/,
  ro: /adresa de e‑mail de mai sus/,
} as const;
const ACCOUNT = { en: /account/i, ro: /cont/i } as const;
const ASSISTANT = { en: /AI assistant/, ro: /asistent AI/ } as const;
const OBJECT = {
  en: /object|stop/i,
  ro: /te opui|opune|obiec|oprești/i,
} as const;
const ERASE = {
  en: /clos\w+ (your|the) account|eras|delet/i,
  ro: /închiz\w+ contul|șterg|ștear|stear/i,
} as const;

const sections = (language: Language, kind: LegalText) =>
  LEGAL_TEXTS[language][kind].sections;
const whole = (language: Language, kind: LegalText) =>
  sections(language, kind)
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');
const paragraphsOf = (language: Language, kind: LegalText) =>
  sections(language, kind).flatMap((s) => s.paragraphs);

const COMPLAINT = { en: /ANSPDCP/, ro: /ANSPDCP/ } as const;
const RETENTION = {
  en: 'How long we keep it',
  ro: 'Cât timp le păstrăm',
} as const;
const YOUR_RIGHTS = { en: 'Your rights', ro: 'Drepturile tale' } as const;
const PROFILE_VIEWS = {
  en: 'Profile views',
  ro: 'Vizualizările profilului',
} as const;

const rightsParagraphs = (language: Language) => {
  const privacy = sections(language, 'privacy');
  const byHeading = (h: string) => privacy.find((s) => s.heading === h)!;
  const rights = byHeading(YOUR_RIGHTS[language]).paragraphs.filter(
    (p) => !COMPLAINT[language].test(p),
  );
  const views = byHeading(PROFILE_VIEWS[language]).paragraphs.filter((p) =>
    OBJECT[language].test(p),
  );
  const erasure = byHeading(RETENTION[language])
    .paragraphs.filter(
      (p) => ERASE[language].test(p) && ACCOUNT[language].test(p),
    )
    .filter((p) => !ASSISTANT[language].test(p));
  return { erasure, rights, views };
};

describe.each(languages)(
  'the %s privacy notice rights paragraphs',
  (language) => {
    // @traces 005-FR-014
    it('the Your rights section points every paragraph to the address above', () => {
      const { rights } = rightsParagraphs(language);

      expect(rights.length).toBeGreaterThan(0);
      for (const p of rights) expect(p).toMatch(ABOVE[language]);
    });

    // @traces 005-FR-014
    it('the profile-view objection paragraph points to the address above', () => {
      const { views } = rightsParagraphs(language);

      expect(views.length).toBeGreaterThan(0);
      for (const p of views) expect(p).toMatch(ABOVE[language]);
    });

    // @traces 005-FR-014
    it('the paragraph on closing the account or erasure points to the address above', () => {
      const { erasure } = rightsParagraphs(language);

      expect(erasure.length).toBeGreaterThan(0);
      for (const p of erasure) expect(p).toMatch(ABOVE[language]);
    });

    // @traces 005-FR-014
    it('a paragraph that points to the address above still names the account', () => {
      const pointing = paragraphsOf(language, 'privacy').filter((p) =>
        ABOVE[language].test(p),
      );

      expect(pointing.length).toBeGreaterThanOrEqual(3);
      for (const p of pointing) expect(p).toMatch(ACCOUNT[language]);
    });

    // @traces 005-FR-014
    it('the pointer appears only in the rights paragraphs, never in the first section', () => {
      const { rights, views, erasure } = rightsParagraphs(language);
      const allowed = new Set([...rights, ...views, ...erasure]);
      const pointing = paragraphsOf(language, 'privacy').filter((p) =>
        ABOVE[language].test(p),
      );

      expect(
        sections(language, 'privacy')[0]!.paragraphs.join('\n'),
      ).not.toMatch(ABOVE[language]);
      for (const p of pointing) expect(allowed.has(p)).toBe(true);
    });

    // @traces 005-FR-014
    it('the pointer is not a second copy of the address', () => {
      const { rights, views, erasure } = rightsParagraphs(language);

      for (const p of [...rights, ...views, ...erasure])
        expect(p).not.toContain('@');
    });

    // @traces 005-FR-014
    it('the e-mail is written exactly once in the notice', () => {
      expect(whole(language, 'privacy').split(EMAIL)).toHaveLength(2);
      expect(
        whole(language, 'privacy').match(/[\w.+-]+@[\w-]+\.[\w.]+/g),
      ).toEqual([EMAIL]);
    });

    // @traces 005-FR-014
    it('the e-mail is in the first section only', () => {
      const holders = sections(language, 'privacy').filter((s) =>
        s.paragraphs.join('\n').includes(EMAIL),
      );

      expect(holders).toEqual([sections(language, 'privacy')[0]]);
    });
  },
);

describe.each(languages)('the %s terms of use', (language) => {
  // @traces 005-FR-014
  it('do not gain a pointer to the address above', () => {
    expect(whole(language, 'terms')).not.toMatch(ABOVE.en);
    expect(whole(language, 'terms')).not.toMatch(ABOVE.ro);
  });

  // @traces 005-FR-014
  it('still write the e-mail exactly once', () => {
    expect(whole(language, 'terms').split(EMAIL)).toHaveLength(2);
  });

  // @traces 005-FR-014
  it('keep twelve sections', () => {
    expect(sections(language, 'terms')).toHaveLength(12);
  });
});

describe.each(kinds)('the %s in both languages', (kind) => {
  // @traces 005-FR-014
  it('keep the same section count and paragraph count per section', () => {
    const counts = (language: Language) =>
      sections(language, kind).map((s) => s.paragraphs.length);

    expect(counts('ro')).toEqual(counts('en'));
  });

  // @traces 005-FR-014
  it('keep the same total paragraph count', () => {
    expect(paragraphsOf('ro', kind)).toHaveLength(
      paragraphsOf('en', kind).length,
    );
  });

  // @traces 005-FR-014
  it('hold the pointer in the same paragraph positions', () => {
    const positions = (language: Language) =>
      paragraphsOf(language, kind).flatMap((p, i) =>
        ABOVE[language].test(p) ? [i] : [],
      );

    expect(positions('ro')).toEqual(positions('en'));
  });
});

describe.each(languages)('the %s operator details', (language) => {
  // @traces 005-FR-014
  it('add no phone number, officer or authority wording', () => {
    const first = sections(language, 'privacy')[0]!.paragraphs.join('\n');

    expect(first).not.toMatch(
      /\+40|\b0\d{9}\b|DPO|data protection officer|responsabil|ANSPDCP|supervisory/i,
    );
  });
});
