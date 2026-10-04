import { NOTIFICATION_TYPES } from './catalogue';
import { checkTemplates } from './template-check';
import type { Template } from './templates';
import { TEMPLATES } from './templates/registry';

const mail = (subject: string) => ({
  button: { label: 'Open', link: 'app' },
  lines: [subject],
  reason: 'Because.',
  subject,
});

const good: Template = {
  audience: 'driver',
  bell: { en: 'Quote from {garage}', ro: 'Ofertă de la {garage}' },
  email: { en: mail('Quote {range}'), ro: mail('Ofertă {range}') },
  example: { garage: 'Auto Ion', link: 'https://m.fx/q/1', range: [1, 2] },
  push: {
    en: { body: 'Open it.', link: 'link', title: 'New quote' },
    ro: { body: 'Deschide.', link: 'link', title: 'Ofertă nouă' },
  },
  sms: { en: 'New quote: {link}', ro: 'Ofertă nouă: {link}' },
  values: { garage: 'text', link: 'link', range: 'lei' },
  whatsapp: {
    en: { name: 'quote_en', slots: ['{garage}'] },
    ro: { name: 'quote_ro', slots: ['{garage}'] },
  },
};

const only = (name: string, template: Template) =>
  checkTemplates({ [name]: template });

const withProblems = (problems: string[], ...needles: string[]) => {
  expect(problems.length).toBeGreaterThan(0);
  const joined = problems.join('\n');
  for (const needle of needles) expect(joined).toContain(needle);
};

describe('the template check on the whole registry', () => {
  it('is empty for no templates', () => {
    expect(checkTemplates({})).toEqual([]);
  });

  it('is repeatable and leaves the registry as it was', () => {
    const before = JSON.stringify(TEMPLATES);
    expect(checkTemplates(TEMPLATES)).toEqual([]);
    expect(checkTemplates(TEMPLATES)).toEqual([]);
    expect(JSON.stringify(TEMPLATES)).toBe(before);
  });

  it('keeps every real key a known type or a variant of one', () => {
    for (const key of Object.keys(TEMPLATES)) {
      const type = key.split('.')[0] ?? '';
      expect(type === 'GENERIC' || type in NOTIFICATION_TYPES).toBe(true);
    }
  });

  it('reports the problems of each broken template by name', () => {
    const broken = { ...good, bell: { en: 'Only English' } };
    withProblems(
      checkTemplates({ QUOTE_RECEIVED: broken, TEST_MESSAGE: broken }),
      'QUOTE_RECEIVED',
      'TEST_MESSAGE',
    );
  });

  it('reports every problem of one template, not only the first', () => {
    const problems = only('QUOTE_RECEIVED', {
      ...good,
      bell: { en: 'Only English {ghost}' },
      sms: { en: 'x'.repeat(71), ro: 'ş' },
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the two-language rule', () => {
  it.each([
    ['email', 'en'],
    ['email', 'ro'],
    ['bell', 'en'],
    ['bell', 'ro'],
    ['push', 'en'],
    ['push', 'ro'],
    ['sms', 'en'],
    ['sms', 'ro'],
    ['whatsapp', 'en'],
    ['whatsapp', 'ro'],
  ] as const)('fails when the %s text lacks %s', (channel, language) => {
    const text = { ...(good[channel] as object) } as Record<string, unknown>;
    delete text[language];
    withProblems(
      only('QUOTE_RECEIVED', { ...good, [channel]: text }),
      'QUOTE_RECEIVED',
      channel,
      language,
    );
  });

  it('fails when the text is present but undefined', () => {
    withProblems(
      only('QUOTE_RECEIVED', { ...good, bell: { en: 'x', ro: undefined } }),
      'bell',
      'ro',
    );
  });

  it('fails a channel that has no language at all', () => {
    withProblems(only('QUOTE_RECEIVED', { ...good, bell: {} }), 'bell');
  });

  it('passes a template that defines only some channels', () => {
    expect(
      only('QUOTE_RECEIVED', {
        audience: 'driver',
        bell: good.bell,
        example: good.example,
        values: good.values,
      }),
    ).toEqual([]);
  });
});

describe('the privacy rule', () => {
  const plated = {
    ...good,
    bell: { en: 'Car {plate}', ro: 'Mașina {plate}' },
    example: { ...good.example, plate: 'B 12 ABC' },
    values: { ...good.values, plate: 'text' as const },
  };

  it.each([
    'garage',
    'mechanic',
    'admin',
  ] as const)('fails a %s template that uses a plate', (audience) => {
    withProblems(only('QUOTE_RECEIVED', { ...plated, audience }), 'plate');
  });

  it('fails a plate in an e-mail line of a garage template', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        audience: 'garage',
        email: {
          en: { ...mail('S'), lines: ['Car {plate}'] },
          ro: { ...mail('S'), lines: ['Mașina {plate}'] },
        },
        example: { ...good.example, plate: 'B 12 ABC' },
        values: { ...good.values, plate: 'text' },
      }),
      'plate',
    );
  });

  it('allows a plate for a driver and for the day sheet', () => {
    expect(only('QUOTE_RECEIVED', plated)).toEqual([]);
    expect(only('DAY_SHEET', { ...plated, audience: 'garage' })).toEqual([]);
  });

  it.each([
    'driver',
    'garage',
    'mechanic',
    'admin',
    'any',
  ] as const)('fails a phone value in a %s template', (audience) => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        audience,
        bell: { en: 'Call {phone}', ro: 'Sună {phone}' },
        example: { ...good.example, phone: '+40700000000' },
        values: { ...good.values, phone: 'text' },
      }),
      'phone',
    );
  });

  it('fails a phone value in the day sheet', () => {
    withProblems(
      only('DAY_SHEET', {
        ...good,
        audience: 'garage',
        bell: { en: 'Call {phone}', ro: 'Sună {phone}' },
        example: { ...good.example, phone: '+40700000000' },
        values: { ...good.values, phone: 'text' },
      }),
      'DAY_SHEET',
      'phone',
    );
  });

  it('does not carry the day sheet exemption to another type', () => {
    withProblems(
      only('QUOTE_RECEIVED', { ...plated, audience: 'garage' }),
      'plate',
    );
  });
});

describe('the push, sms and whatsapp limits', () => {
  const pushed = (title: string, body: string, link = 'link') => ({
    ...good,
    push: {
      en: { body, link, title },
      ro: { body, link, title },
    },
  });

  it('passes the limits exactly', () => {
    expect(
      only('QUOTE_RECEIVED', pushed('x'.repeat(50), 'y'.repeat(120))),
    ).toEqual([]);
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        sms: { en: 'a'.repeat(70), ro: 'ș'.repeat(70) },
      }),
    ).toEqual([]);
  });

  it('fails a title of 51 and a body of 121', () => {
    withProblems(
      only('QUOTE_RECEIVED', pushed('x'.repeat(51), 'b')),
      'QUOTE_RECEIVED',
      'push',
    );
    withProblems(
      only('QUOTE_RECEIVED', pushed('t', 'y'.repeat(121))),
      'QUOTE_RECEIVED',
      'push',
    );
  });

  it('measures a push limit after the example values are filled in', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...pushed('{garage}', 'b'),
        example: { ...good.example, garage: 'g'.repeat(51) },
      }),
      'push',
    );
  });

  it('fails a push that has no link', () => {
    withProblems(only('QUOTE_RECEIVED', pushed('t', 'b', '')), 'push');
  });

  it('fails when the example lacks a value the template uses', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        example: { garage: 'Auto Ion', range: [1, 2] },
      }),
      'QUOTE_RECEIVED',
    );
  });

  it('fails an sms of 71 characters in either language', () => {
    withProblems(
      only('QUOTE_RECEIVED', { ...good, sms: { en: 'a', ro: 'ș'.repeat(71) } }),
      'sms',
      'ro',
    );
    withProblems(
      only('QUOTE_RECEIVED', { ...good, sms: { en: 'a'.repeat(71), ro: 'a' } }),
      'sms',
      'en',
    );
  });

  it('counts the link in the sms length', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        example: { ...good.example, link: `https://m.fx/${'a'.repeat(60)}` },
        sms: { en: 'New: {link}', ro: 'Nou: {link}' },
      }),
      'sms',
    );
  });

  it('fails a whatsapp template with no name', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        whatsapp: {
          en: { name: '', slots: ['{garage}'] },
          ro: { name: 'quote_ro', slots: ['{garage}'] },
        },
      }),
      'whatsapp',
      'en',
    );
  });

  it('fails a whatsapp slot that renders empty', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        whatsapp: {
          en: { name: 'q', slots: ['{garage}', ''] },
          ro: { name: 'q', slots: ['{garage}'] },
        },
      }),
      'whatsapp',
    );
  });

  it('fails a whatsapp slot that is only spaces', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        whatsapp: {
          en: { name: 'q', slots: ['   '] },
          ro: { name: 'q', slots: ['{garage}'] },
        },
      }),
      'whatsapp',
    );
  });
});

describe('the cedilla rule', () => {
  const cedilla = ['ş', 'ţ', 'Ş', 'Ţ'];
  const place: Array<[string, (c: string) => Template]> = [
    ['bell', (c) => ({ ...good, bell: { en: 'x', ro: `a${c}b` } })],
    ['english bell', (c) => ({ ...good, bell: { en: `a${c}b`, ro: 'x' } })],
    [
      'email subject',
      (c) => ({ ...good, email: { en: mail('x'), ro: mail(`a${c}`) } }),
    ],
    [
      'email line',
      (c) => ({
        ...good,
        email: { en: mail('x'), ro: { ...mail('x'), lines: [`a${c}`] } },
      }),
    ],
    [
      'email button',
      (c) => ({
        ...good,
        email: {
          en: mail('x'),
          ro: { ...mail('x'), button: { label: `a${c}`, link: 'app' } },
        },
      }),
    ],
    [
      'email reason',
      (c) => ({
        ...good,
        email: { en: mail('x'), ro: { ...mail('x'), reason: `a${c}` } },
      }),
    ],
    [
      'push title',
      (c) => ({
        ...good,
        push: {
          en: good.push?.en,
          ro: { body: 'b', link: 'link', title: `a${c}` },
        },
      }),
    ],
    [
      'push body',
      (c) => ({
        ...good,
        push: {
          en: good.push?.en,
          ro: { body: `a${c}`, link: 'link', title: 't' },
        },
      }),
    ],
    ['sms', (c) => ({ ...good, sms: { en: 'x', ro: `a${c}` } })],
    [
      'whatsapp slot',
      (c) => ({
        ...good,
        whatsapp: {
          en: good.whatsapp?.en,
          ro: { name: 'q', slots: [`a${c}`] },
        },
      }),
    ],
  ];

  for (const [where, build] of place) {
    it.each(cedilla)(`fails ${where} with %s`, (letter) => {
      withProblems(only('QUOTE_RECEIVED', build(letter)), 'QUOTE_RECEIVED');
    });
  }

  it('accepts the comma-below letters', () => {
    expect(
      only('QUOTE_RECEIVED', { ...good, bell: { en: 'x', ro: 'șțȘȚ' } }),
    ).toEqual([]);
  });
});

describe('undeclared values, unknown types and unrenderable templates', () => {
  it.each([
    'bell',
    'email',
    'push',
    'sms',
    'whatsapp',
  ] as const)('fails an undeclared placeholder in the %s text', (channel) => {
    const ghosted: Record<string, unknown> = {
      bell: { en: 'a {ghost}', ro: 'a {ghost}' },
      email: {
        en: { ...mail('x'), lines: ['{ghost}'] },
        ro: { ...mail('x'), lines: ['{ghost}'] },
      },
      push: {
        en: { body: '{ghost}', link: 'link', title: 't' },
        ro: { body: '{ghost}', link: 'link', title: 't' },
      },
      sms: { en: '{ghost}', ro: '{ghost}' },
      whatsapp: {
        en: { name: 'q', slots: ['{ghost}'] },
        ro: { name: 'q', slots: ['{ghost}'] },
      },
    };
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        [channel]: ghosted[channel],
        example: { ...good.example, ghost: 'x' },
      }),
      'QUOTE_RECEIVED',
      'ghost',
    );
  });

  it('fails an undeclared placeholder in an e-mail subject', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        email: { en: mail('{ghost}'), ro: mail('{ghost}') },
      }),
      'ghost',
    );
  });

  it('fails a button that links to a value the template does not declare', () => {
    const button = { label: 'Open', link: 'nowhere' };
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        email: {
          en: { ...mail('x'), button },
          ro: { ...mail('x'), button },
        },
      }),
      'QUOTE_RECEIVED',
    );
  });

  it('fails a template whose type the catalogue does not know', () => {
    withProblems(only('NOT_A_TYPE', good), 'NOT_A_TYPE');
    withProblems(only('NOT_A_TYPE.grouped', good), 'NOT_A_TYPE');
  });

  it('accepts a variant of a known type', () => {
    expect(only('QUOTE_RECEIVED.grouped', good)).toEqual([]);
  });

  it('does not take a lowercase type for a known one', () => {
    withProblems(only('quote_received', good), 'quote_received');
  });

  it('does not take an inherited object property for a known type', () => {
    withProblems(only('constructor', good), 'constructor');
    withProblems(only('toString', good), 'toString');
  });

  it('fails a template that does not render with its example values', () => {
    withProblems(
      only('QUOTE_RECEIVED', { ...good, example: { link: 'https://m.fx' } }),
      'QUOTE_RECEIVED',
    );
  });

  it('fails an example that holds null for a declared value', () => {
    withProblems(
      only('QUOTE_RECEIVED', {
        ...good,
        example: { ...good.example, garage: null },
      }),
      'QUOTE_RECEIVED',
    );
  });
});
