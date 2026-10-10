import { TEMPLATES } from './registry';
import { reasonLabel } from './verification-result';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const KIND = 'VERIFICATION_RESULT';
const DECISIONS = ['approved', 'more_requested', 'rejected'] as const;
const link = 'https://motorfix.test/app/garage';
const profile = 'https://motorfix.test/ro/garages/atelier-dinamo';
const note = 'Lipsește pagina 2 din <b>CUI</b> & avizul RAR';
const LANGUAGES = ['ro', 'en'] as const;

const paramsOf = (decision: (typeof DECISIONS)[number]) =>
  decision === 'approved'
    ? { app: 'https://motorfix.test', decision, link, profile }
    : {
        app: 'https://motorfix.test',
        decision,
        link,
        note,
        reason: 'Documente',
      };

const nameOf = (decision: (typeof DECISIONS)[number]) =>
  templateName(KIND, { decision });

// @traces 209-FR-005 209-FR-011
describe('the verification result messages to garage owners', () => {
  it.each(DECISIONS)(
    'registers the %s variant for the garage and passes the template check',
    (decision) => {
      const name = nameOf(decision);
      expect(TEMPLATES[name]?.audience).toBe('garage');
      expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
    },
  );

  it.each(DECISIONS)(
    'has e-mail, push, WhatsApp and bell texts in both languages for %s',
    (decision) => {
      for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
        expect(
          Object.keys(TEMPLATES[nameOf(decision)]?.[channel] ?? {}).sort(),
        ).toEqual(['en', 'ro']);
      }
    },
  );

  it('stays always sent in the catalogue', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it.each(DECISIONS)('takes no phone or plate in %s', (decision) => {
    const values = Object.keys(TEMPLATES[nameOf(decision)]?.values ?? {});
    expect(values).not.toContain('phone');
    expect(values).not.toContain('plate');
  });

  it.each(LANGUAGES)(
    'gives each decision its own subject and bell text in %s',
    (language) => {
      const subjects = DECISIONS.map(
        (d) => render(nameOf(d), 'email', language, paramsOf(d)).subject,
      );
      const bells = DECISIONS.map((d) => bellText(KIND, language, paramsOf(d)));
      expect(new Set(subjects).size).toBe(3);
      expect(new Set(bells).size).toBe(3);
    },
  );

  it.each(DECISIONS)(
    'opens the garage dashboard from the %s e-mail button',
    (decision) => {
      for (const language of LANGUAGES) {
        const mail = render(nameOf(decision), 'email', language, {
          ...paramsOf(decision),
        });
        expect(mail.text).toContain(`: ${link}`);
        expect(mail.html).toContain(`href="${link}"`);
        expect(
          render(nameOf(decision), 'push', language, paramsOf(decision)),
        ).toMatchObject({ link });
      }
    },
  );
});

// @traces 209-FR-006
describe('the approved message', () => {
  const params = paramsOf('approved');

  it('says in Romanian the garage is approved and on the map, with its public profile', () => {
    const mail = render(nameOf('approved'), 'email', 'ro', params);

    expect(mail.subject).toBe('Service-ul tău e aprobat și pe hartă');
    expect(mail.text).toContain(profile);
    expect(mail.text).toContain(
      'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; rezultatul verificării se trimite întotdeauna.',
    );
    expect(bellText(KIND, 'ro', params)).toMatch(/aprobat/);
  });

  it('says the same in English', () => {
    const mail = render(nameOf('approved'), 'email', 'en', {
      ...params,
      profile: 'https://motorfix.test/en/garages/atelier-dinamo',
    });

    expect(mail.subject).toMatch(/approved/i);
    expect(mail.subject).toMatch(/map/i);
    expect(mail.text).toContain(
      'https://motorfix.test/en/garages/atelier-dinamo',
    );
    expect(bellText(KIND, 'en', params)).toMatch(/approved/i);
  });

  it('carries no reason or note and names no admin', () => {
    const values = Object.keys(TEMPLATES[nameOf('approved')]?.values ?? {});

    expect(values.sort()).toEqual(['link', 'profile']);
    for (const language of LANGUAGES) {
      const mail = render(nameOf('approved'), 'email', language, params);
      expect(mail.text).not.toMatch(/admin|motiv|reason/i);
    }
  });

  it.each(LANGUAGES)(
    'names the approved WhatsApp template in %s, with the profile',
    (language) => {
      expect(render(nameOf('approved'), 'whatsapp', language, params)).toEqual({
        name: `motorfix_verification_approved_${language}`,
        params: [profile],
      });
    },
  );
});

// @traces 209-FR-007 209-FR-008 209-FR-010
describe.each([
  [
    'more_requested',
    'poți completa fără să o iei de la capăt',
    'you can complete it without starting over',
  ],
  [
    'rejected',
    'poți corecta listarea și o trimiți din nou',
    'you can correct the listing and send it again',
  ],
] as const)('the %s message', (decision, ro, en) => {
  const params = paramsOf(decision);

  it('gives the reason label, the note word for word and what comes next, in Romanian', () => {
    const mail = render(nameOf(decision), 'email', 'ro', params);

    expect(mail.text).toContain('Documente');
    expect(mail.text).toContain(note);
    expect(mail.text).toContain(ro);
  });

  it('does the same in English, keeping the note as it was typed', () => {
    const mail = render(nameOf(decision), 'email', 'en', {
      ...params,
      reason: 'Documents',
    });

    expect(mail.text).toContain('Documents');
    expect(mail.text).toContain(note);
    expect(mail.text).toContain(en);
  });

  it('escapes the note in the HTML part and never reads it as markup', () => {
    const mail = render(nameOf(decision), 'email', 'ro', params);

    expect(mail.html).toContain(
      'Lipsește pagina 2 din &lt;b&gt;CUI&lt;/b&gt; &amp; avizul RAR',
    );
    expect(mail.html).not.toContain('<b>CUI</b>');
  });

  it('keeps the note out of the push and the bell', () => {
    for (const language of LANGUAGES) {
      const push = render(nameOf(decision), 'push', language, params);
      expect(`${push.title} ${push.body}`).not.toMatch(/CUI|RAR/);
      expect(bellText(KIND, language, params)).not.toMatch(/CUI|RAR/);
    }
  });

  it('keeps the note out of WhatsApp, naming the reason only', () => {
    expect(render(nameOf(decision), 'whatsapp', 'ro', params)).toEqual({
      name: `motorfix_verification_${decision}_ro`,
      params: ['Documente'],
    });
  });
});

// @traces 209-FR-009
describe('the reason label', () => {
  it.each([
    ['documents', 'Documente', 'Documents'],
    ['rar', 'Autorizație RAR', 'RAR authorisation'],
    ['address', 'Adresă', 'Address'],
    ['photos', 'Fotografii', 'Photos'],
    ['other', 'Alt motiv', 'Other reason'],
  ])('names %s in both languages', (code, ro, en) => {
    expect(reasonLabel(code, 'ro')).toBe(ro);
    expect(reasonLabel(code, 'en')).toBe(en);
  });

  it.each([['expired'], [''], [null], ['constructor'], ['toString']])(
    'gives %j the other label',
    (code) => {
      expect(reasonLabel(code, 'ro')).toBe('Alt motiv');
      expect(reasonLabel(code, 'en')).toBe('Other reason');
    },
  );

  it('falls back to Romanian for a language it does not know', () => {
    expect(reasonLabel('rar', 'de')).toBe('Autorizație RAR');
  });
});
