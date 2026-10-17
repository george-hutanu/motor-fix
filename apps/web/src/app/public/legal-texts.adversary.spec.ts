import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts/consent';

import { LEGAL_TEXTS, type LegalText } from './legal-texts';

const kinds: LegalText[] = ['terms', 'privacy'];
const languages = ['ro', 'en'] as const;
type Language = (typeof languages)[number];

const whole = (language: Language, kind: LegalText) =>
  LEGAL_TEXTS[language][kind].sections
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');

const section = (language: Language, index: number) =>
  LEGAL_TEXTS[language].privacy.sections[index]!.paragraphs.join('\n');

const profileViews = (language: Language) => section(language, 5);

const numbers = (text: string) =>
  (text.match(/\d+/g) ?? []).filter((n) => n !== '1').sort();

describe('legal texts, structure and hygiene', () => {
  // @traces 243-FR-012 1203-FR-005 366-FR-003
  it.each([
    ['terms', TERMS_VERSION, '2026-10-12'],
    ['privacy', PRIVACY_VERSION, '2026-10-17'],
  ] as const)(
    'the %s of both languages carries the shared version',
    (kind, expected, date) => {
      expect(LEGAL_TEXTS.ro[kind].version).toBe(expected);
      expect(LEGAL_TEXTS.en[kind].version).toBe(expected);
      expect(expected).toBe(date);
    },
  );

  // @traces 243-FR-012 1203-FR-005
  it.each(languages)(
    'no %s text still names a replaced version date',
    (language) => {
      for (const kind of kinds)
        for (const replaced of ['2026-10-05', '2026-10-11'])
          expect(whole(language, kind)).not.toContain(replaced);
    },
  );

  // @traces 243-FR-001 1203-FR-009
  it.each(kinds)(
    'the %s has the same sections and paragraph counts in both languages',
    (kind) => {
      const counts = (language: Language) =>
        LEGAL_TEXTS[language][kind].sections.map((s) => s.paragraphs.length);
      expect(counts('ro')).toEqual(counts('en'));
    },
  );

  // @traces 243-FR-001
  it.each(kinds)(
    'every %s section has a heading and non-empty trimmed paragraphs',
    (kind) => {
      for (const language of languages)
        for (const s of LEGAL_TEXTS[language][kind].sections) {
          expect(s.heading.trim()).toBe(s.heading);
          expect(s.heading.length).toBeGreaterThan(2);
          expect(s.paragraphs.length).toBeGreaterThanOrEqual(1);
          for (const p of s.paragraphs) {
            expect(p.trim()).toBe(p);
            expect(p.length).toBeGreaterThan(30);
          }
        }
    },
  );

  // @traces 243-FR-001
  it.each(kinds)('the %s repeats no heading within a language', (kind) => {
    for (const language of languages) {
      const headings = LEGAL_TEXTS[language][kind].sections.map(
        (s) => s.heading,
      );
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  // @traces 243-FR-001
  it.each(languages)(
    'no %s text holds a placeholder or unfinished marker',
    (language) => {
      for (const kind of kinds)
        expect(whole(language, kind)).not.toMatch(
          /TODO|TBD|FIXME|lorem|ipsum|XXX|\[\s*\w*\s*\]|\{\{|\}\}|undefined|\[object/i,
        );
    },
  );

  // @traces 243-FR-001
  it.each(kinds)(
    'the %s uses the same numeric facts in each section in both languages',
    (kind) => {
      const ro = LEGAL_TEXTS.ro[kind].sections;
      const en = LEGAL_TEXTS.en[kind].sections;
      ro.forEach((s, i) => {
        const a = numbers([s.heading, ...s.paragraphs].join('\n'));
        const b = numbers([en[i]!.heading, ...en[i]!.paragraphs].join('\n'));
        expect({ numbers: a, section: i }).toEqual({ numbers: b, section: i });
      });
    },
  );

  // @traces 243-FR-001
  it.each(kinds)(
    'the %s of each language is not the other language pasted in',
    (kind) => {
      const en = whole('en', kind);
      const ro = whole('ro', kind);
      // The operator's name and seat are written as registered, in Romanian.
      const names =
        /rovinietă|HUȚANU GEORGE-DRAGOȘ PERSOANĂ FIZICĂ AUTORIZATĂ|București/g;
      expect(en.replace(names, '')).not.toMatch(/[ăîșțâ]/i);
      expect(ro).toMatch(/[ăîșțâ]/i);
      expect(ro).not.toBe(en);
    },
  );
});

describe('legal texts, providers', () => {
  const unlisted = [
    'Cloudflare',
    'Sentry',
    'Stripe',
    'Google Analytics',
    'Mailchimp',
    'Twilio',
    'Amazon',
    'AWS',
    'Vercel',
    'Netlify',
    'Heroku',
    'Facebook',
    'Meta ',
    'Hotjar',
    'Mapbox',
    'Datadog',
    'Firebase',
    'Microsoft',
    'SendGrid',
    'Mailgun',
    'Intercom',
    'Segment',
    'Mixpanel',
    'PayPal',
    'Hetzner',
    'DigitalOcean',
    'OpenAI',
    'Anthropic',
    'Matomo',
    'Posthog',
    'HubSpot',
    'Zendesk',
    'Google Maps',
    'Nominatim',
    'OpenStreetMap',
  ];

  // @traces 243-FR-003
  it.each(languages)(
    'the %s privacy notice names no provider outside the listed ones',
    (language) => {
      const text = whole(language, 'privacy');
      for (const name of unlisted) expect(text).not.toContain(name);
    },
  );

  // @traces 243-FR-003
  it.each(languages)(
    'the %s terms name no third-party provider',
    (language) => {
      const text = whole(language, 'terms');
      for (const name of [
        ...unlisted,
        'Railway',
        'Brevo',
        'Grafana',
        'Plausible',
        'Geoapify',
        'OpenFreeMap',
      ])
        expect(text).not.toContain(name);
    },
  );

  // @traces 243-FR-003
  it.each(languages)(
    'the %s privacy notice names every listed provider in the providers section',
    (language) => {
      const providers = section(language, 3);
      for (const name of [
        'Railway',
        'Brevo',
        'Grafana Cloud',
        'Plausible',
        'OpenFreeMap',
        'Geoapify',
        'Google',
        'Apple',
      ])
        expect(providers).toContain(name);
    },
  );

  // @traces 243-FR-003
  it.each([
    [
      'en',
      /EU|European Union/,
      /Data Privacy Framework/,
      /standard contractual clauses/i,
    ],
    [
      'ro',
      /UE|Uniunea Europeană/,
      /Data Privacy Framework/,
      /clauzele contractuale standard/i,
    ],
  ] as const)(
    'the %s providers section states EU storage and the transfer safeguards',
    (language, eu, dpf, scc) => {
      const providers = section(language, 3);
      expect(providers).toMatch(eu);
      expect(providers).toMatch(dpf);
      expect(providers).toMatch(scc);
    },
  );

  // @traces 243-FR-003
  it.each(languages)(
    'the %s notice says Plausible loads only with consent and Geoapify never sees the address',
    (language) => {
      const providers = section(language, 3);
      const plausible = providers
        .split(/(?<=[.;])\s/)
        .filter((s) => s.includes('Plausible'))
        .join(' ');
      expect(plausible).toMatch(
        language === 'en' ? /agree|consent/i : /de acord|acord/i,
      );
      const geoapify = providers
        .split(/(?<=[.;])\s/)
        .filter((s) => s.includes('Geoapify'))
        .join(' ');
      expect(geoapify).toMatch(
        language === 'en' ? /never|not/i : /niciodată|nu /i,
      );
    },
  );
});

describe('profile view section, every fact in both languages', () => {
  const facts: Record<Language, [string, RegExp][]> = {
    en: [
      ['distinct people per day', /different people|distinct people/i],
      ['signed-in counted by account', /signed in[^.]*account/i],
      ['keyed one-way hash', /one-way/i],
      ['connection address', /connection address/i],
      ['browser description', /browser(’s|'s)? description/i],
      ['a secret', /secret/i],
      ['32 random bytes', /32 random bytes/i],
      ['fresh every day Romanian time', /fresh every day \(Romanian time\)/i],
      ['in memory only', /in-memory/i],
      ['discarded at day end', /discarded at the end of that day/i],
      ['counters discarded within two days', /within two days/i],
      ['daily totals per garage', /daily totals per garage/i],
      ['per arrival source', /way of arriving|arrival source/i],
      [
        'not stored logged or sent to monitoring',
        /we do not store or log them, and our servers do not send them to the monitoring provider/i,
      ],
      ['no cookie', /cookie/i],
      ['nothing placed on device', /Nothing is placed on your device/i],
      ['nothing read from it', /nothing is read from it/i],
      ['no consent asked', /do not ask for your consent/i],
      [
        'legitimate interest article',
        /legitimate interest \(GDPR Art\. 6\(1\)\(f\)\)/i,
      ],
      ['bots', /Bots/],
      ['own staff', /staff/i],
      ['administrators', /administrators/i],
      ['may object', /object/i],
      ['contact route', /from your account/i],
    ],
    ro: [
      ['distinct people per day', /persoane diferite/i],
      ['signed-in counted by account', /autentificat[^.]*cont/i],
      ['keyed one-way hash', /într.un singur sens/i],
      ['connection address', /adresei conexiunii/i],
      ['browser description', /descrierii browserului/i],
      ['a secret', /secret/i],
      ['32 random bytes', /32 de octeți aleatori/i],
      [
        'fresh every day Romanian time',
        /din nou în fiecare zi \(după ora României\)/i,
      ],
      ['in memory only', /memoria de scurtă durată/i],
      ['discarded at day end', /aruncat la sfârșitul acelei zile/i],
      ['counters discarded within two days', /două zile/i],
      ['daily totals per garage', /totalurile zilnice pe service/i],
      ['per arrival source', /felul în care s.a ajuns/i],
      [
        'not stored logged or sent to monitoring',
        /nu le stocăm, nu le înregistrăm în jurnale, iar serverele noastre nu le trimit furnizorului de monitorizare/i,
      ],
      ['no cookie', /cookie/i],
      ['nothing placed on device', /Nu punem nimic pe dispozitivul tău/i],
      ['nothing read from it', /nu citim nimic de pe el/i],
      ['no consent asked', /nu îți cerem acordul/i],
      [
        'legitimate interest article',
        /interesul nostru legitim \(GDPR art\. 6 alin\. \(1\) lit\. f\)/i,
      ],
      ['bots', /Roboții/],
      ['own staff', /personalul/i],
      ['administrators', /administratorii/i],
      ['may object', /opune/i],
      ['contact route', /din contul tău/i],
    ],
  };

  // @traces 243-FR-009
  it.each(languages)(
    'the %s section is the one headed for profile views',
    (language) => {
      expect(LEGAL_TEXTS[language].privacy.sections[5]!.heading).toMatch(
        language === 'en' ? /Profile views/ : /Vizualiz/,
      );
    },
  );

  // @traces 243-FR-009
  it.each(languages.flatMap((l) => facts[l].map((f) => [l, ...f] as const)))(
    'the %s section states: %s',
    (language, _name, pattern) => {
      expect(profileViews(language)).toMatch(pattern);
    },
  );

  // @traces 243-FR-009
  it.each(languages)(
    'the %s section promises no more retention than two days for the key',
    (language) => {
      const text = profileViews(language);
      expect(text).not.toMatch(/\b(30|90|7|14)\s+(days|de zile)\b/);
      expect(text).not.toMatch(
        /\b(indefinitely|permanent|pentru totdeauna)\b/i,
      );
    },
  );

  // @traces 243-FR-009
  it.each(languages)(
    'the %s section does not claim a cookie, local storage or fingerprint is used',
    (language) => {
      const text = profileViews(language);
      expect(text).not.toMatch(
        /localStorage|sessionStorage|fingerprint|amprent[ăa] digital/i,
      );
      expect(text).not.toMatch(
        /we (set|store|place) a cookie|setăm un cookie/i,
      );
    },
  );
});

describe('required facts of the other sections in both languages', () => {
  // @traces 243-FR-002
  it.each([
    [
      'en',
      [
        /ITP/,
        /RCA/,
        /rovinietă/i,
        /3 photos/i,
        /Andrei M\./,
        /city/i,
        /bounce/i,
        /push/i,
        /WhatsApp/,
        /90 days/,
      ],
    ],
    [
      'ro',
      [
        /ITP/,
        /RCA/,
        /rovinietă/i,
        /3 fotografii/i,
        /Andrei M\./,
        /oraș/i,
        /(întors|revenit|respins|returnat)/i,
        /push/i,
        /WhatsApp/,
        /90 de zile/,
      ],
    ],
  ] as const)(
    'the %s data section lists the account, car, review and device items',
    (language, patterns) => {
      const text = whole(language, 'privacy');
      for (const p of patterns) expect(text).toMatch(p);
    },
  );

  // @traces 243-FR-004
  it.each([
    ['en', [/5 years/, /90 days/, /longest|at most|no longer than/i]],
    ['ro', [/5 ani/, /90 de zile/, /cel mult|maxim|cel mai lung/i]],
  ] as const)(
    'the %s retention section states periods as maximums',
    (language, patterns) => {
      const body = section(language, 4);
      for (const p of patterns) expect(body).toMatch(p);
    },
  );

  // @traces 243-FR-005
  it.each([
    [
      'en',
      [
        /see your data|access/i,
        /corrected|rectif/i,
        /erased|erasure/i,
        /restrict/i,
        /portable/i,
        /object/i,
        /withdraw/i,
        /ANSPDCP/,
      ],
    ],
    [
      'ro',
      [
        /acces|vezi/i,
        /corect|rectific/i,
        /șters|ștergere/i,
        /restr/i,
        /portabil/i,
        /te opui|opun/i,
        /retrag/i,
        /ANSPDCP/,
      ],
    ],
  ] as const)(
    'the %s rights section lists every right and the authority',
    (language, patterns) => {
      const rights = LEGAL_TEXTS[language].privacy.sections
        .at(-2)!
        .paragraphs.join('\n');
      for (const p of patterns) expect(rights).toMatch(p);
    },
  );

  // @traces 243-FR-006
  it.each([
    [
      'en',
      [/mf_refresh/, /30 days/, /keep me signed in|remember me/i, /10 minutes/],
    ],
    [
      'ro',
      [
        /mf_refresh/,
        /30 de zile/,
        /ține‑mă|ține-mă|rămâi|păstrează/i,
        /10 minute/,
      ],
    ],
  ] as const)(
    'the %s cookies section states the sign-in cookies and their lifetimes',
    (language, patterns) => {
      const cookies =
        LEGAL_TEXTS[language].privacy.sections[7]!.paragraphs.join('\n');
      for (const p of patterns) expect(cookies).toMatch(p);
    },
  );

  // @traces 243-FR-014
  it.each([
    [
      'en',
      [
        /news/i,
        /analytics/i,
        /notification settings/i,
        /cookie settings/i,
        /withdraw/i,
      ],
    ],
    [
      'ro',
      [
        /noutăți/i,
        /analiz/i,
        /setările de notificări/i,
        /Setări cookie/,
        /retrag/i,
      ],
    ],
  ] as const)(
    'the %s notice points to where each consent is changed',
    (language, patterns) => {
      const consents =
        LEGAL_TEXTS[language].privacy.sections[8]!.paragraphs.join('\n');
      for (const p of patterns) expect(consents).toMatch(p);
    },
  );
});

describe('monitoring provider, what it sees from the browser', () => {
  const sees: Record<Language, RegExp> = {
    en: /Grafana Cloud[^.]*\.[^.]*connection address/i,
    ro: /Grafana Cloud[^.]*\.[^.]*adresa conexiunii/i,
  };

  // @traces 243-FR-003
  it.each(languages)(
    'the %s notice says Grafana Cloud sees the connection address of browser reports',
    (language) => {
      expect(whole(language, 'privacy')).toMatch(sees[language]);
    },
  );

  // @traces 243-FR-015
  it.each(languages)(
    'the %s profile-view section no longer says the address never reaches monitoring at all',
    (language) => {
      expect(profileViews(language)).not.toMatch(
        language === 'en'
          ? /not stored, logged or sent to the monitoring provider/i
          : /nu le înregistrăm în jurnale și nu le trimitem furnizorului/i,
      );
    },
  );
});
