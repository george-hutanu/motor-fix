import {
  bellText,
  CHANNELS,
  render,
  type Template,
  TemplateError,
  templateName,
} from './templates';
import { TEMPLATES } from './templates/registry';

const APP = 'https://motorfix.test';

const mail = (subject: string, lines: string[], link = 'app') => ({
  button: { label: 'Open', link },
  lines,
  reason: 'Because.',
  subject,
});

const registryWith = (
  template: Partial<Template>,
  name = 'QUOTE_RECEIVED',
): Record<string, Template> => ({
  ...TEMPLATES,
  [name]: { audience: 'driver', example: {}, values: {}, ...template },
});

const lineTemplate = (
  text: string,
  values: Template['values'],
): Record<string, Template> =>
  registryWith({
    bell: { en: text, ro: text },
    email: {
      en: mail('S', [text]),
      ro: mail('S', [text]),
    },
    values,
  });

const failure = (run: () => unknown): TemplateError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateError);
    return error as TemplateError;
  }
  throw new Error('expected a TemplateError');
};

const COUNT = registryWith({
  email: {
    en: mail('{count} new quotes', ['x']),
    ro: mail('{count} oferte noi', ['x']),
  },
  values: { count: 'count' },
});

const subjectFor = (count: unknown, language: string) =>
  render('QUOTE_RECEIVED', 'email', language, { app: APP, count }, COUNT)
    .subject;

describe('Romanian plural of a grouped count', () => {
  it.each([
    [2, '2 oferte noi'],
    [19, '19 oferte noi'],
    [20, '20 de oferte noi'],
    [21, '21 de oferte noi'],
    [99, '99 de oferte noi'],
    [100, '100 de oferte noi'],
    [101, '101 oferte noi'],
    [119, '119 oferte noi'],
    [120, '120 de oferte noi'],
    [219, '219 oferte noi'],
    [299, '299 de oferte noi'],
  ])('writes %d as "%s"', (count, expected) => {
    expect(subjectFor(count, 'ro')).toBe(expected);
  });

  it('takes "de" for four digits ending 20 to 99', () => {
    expect(subjectFor(2020, 'ro')).toMatch(/^2\.?020 de oferte noi$/);
    expect(subjectFor(2019, 'ro')).toMatch(/^2\.?019 oferte noi$/);
  });

  it('never adds "de" in English', () => {
    expect(subjectFor(20, 'en')).toBe('20 new quotes');
    expect(subjectFor(3, 'en')).toBe('3 new quotes');
  });

  it('renders a count that is not a number as the dash', () => {
    const subject = subjectFor('lots', 'ro');
    expect(subject).toContain('—');
    expect(subject).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('prices and dates', () => {
  const money = registryWith({
    bell: { en: 'Quote {range}', ro: 'Oferta {range}' },
    values: { range: 'lei' },
  });
  const priced = (range: unknown, language: string) =>
    render('QUOTE_RECEIVED', 'bell', language, { range }, money);

  it('writes a range in each language', () => {
    expect(priced([125000, 160000], 'ro')).toBe('Oferta 1.250–1.600 lei');
    expect(priced([125000, 160000], 'en')).toBe('Quote 1,250–1,600 lei');
  });

  it('writes equal ends as one price', () => {
    expect(priced([125000, 125000], 'ro')).toBe('Oferta 1.250 lei');
    expect(priced([125000, 125000], 'en')).toBe('Quote 1,250 lei');
  });

  it('writes a single amount', () => {
    expect(priced(125000, 'ro')).toBe('Oferta 1.250 lei');
  });

  it('writes the dash for a price that is not a number', () => {
    for (const bad of ['abc', Number.NaN, {}, [null, 'x']]) {
      const text = priced(bad, 'en');
      expect(text).toContain('—');
      expect(text).not.toMatch(/NaN|undefined|object/);
    }
  });

  const when = registryWith({
    bell: { en: 'At {at}', ro: 'La {at}' },
    values: { at: 'when' },
  });
  const at = (value: unknown, language: string) =>
    render('QUOTE_RECEIVED', 'bell', language, { at: value }, when);

  it('writes a booking in Bucharest time in each language', () => {
    expect(at('2026-11-03T12:30:00Z', 'ro')).toBe('La 3 nov. 2026, 14:30');
    expect(at('2026-11-03T12:30:00Z', 'en')).toBe('At 3 Nov 2026, 14:30');
  });

  it('accepts a Date and an epoch number as an instant', () => {
    expect(at(new Date('2026-11-03T12:30:00Z'), 'en')).toBe(
      'At 3 Nov 2026, 14:30',
    );
    expect(at(Date.parse('2026-11-03T12:30:00Z'), 'en')).toBe(
      'At 3 Nov 2026, 14:30',
    );
  });

  it('uses summer time before and winter time after the clocks go back', () => {
    expect(at('2026-10-25T00:30:00Z', 'en')).toBe('At 25 Oct 2026, 03:30');
    expect(at('2026-10-25T02:30:00Z', 'en')).toBe('At 25 Oct 2026, 04:30');
  });

  it('puts a late UTC evening on the next Bucharest day', () => {
    expect(at('2026-12-31T22:30:00Z', 'en')).toBe('At 1 Jan 2027, 00:30');
  });

  it('writes the dash for an invalid instant', () => {
    for (const bad of ['not a date', Number.NaN, new Date('x'), {}]) {
      expect(at(bad, 'ro')).toBe('La —');
    }
  });
});

describe('missing values', () => {
  const needs = lineTemplate('Hello {name}', { name: 'text' });

  it.each([
    ['absent', {}],
    ['null', { name: null }],
    ['undefined', { name: undefined }],
  ])('fails when the value is %s and names it', (_label, params) => {
    const error = failure(() =>
      render('QUOTE_RECEIVED', 'bell', 'en', params, needs),
    );
    expect(error.template).toBe('QUOTE_RECEIVED');
    expect(error.channel).toBe('bell');
    expect(error.reason).toContain('name');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not treat the inherited property %s as supplied',
    (key) => {
      const registry = lineTemplate(`Hello {${key}}`, { [key]: 'text' });
      const error = failure(() =>
        render('QUOTE_RECEIVED', 'bell', 'en', {}, registry),
      );
      expect(error.reason).toContain(key);
    },
  );

  it('accepts zero and false as supplied values', () => {
    const registry = lineTemplate('N={n}', { n: 'text' });
    expect(render('QUOTE_RECEIVED', 'bell', 'en', { n: 0 }, registry)).toBe(
      'N=0',
    );
    expect(render('QUOTE_RECEIVED', 'bell', 'en', { n: false }, registry)).toBe(
      'N=false',
    );
  });

  it('fails an e-mail whose button link value is absent', () => {
    const registry = registryWith({
      email: {
        en: mail('S', ['x'], 'target'),
        ro: mail('S', ['x'], 'target'),
      },
      values: { target: 'link' },
    });
    const error = failure(() =>
      render('QUOTE_RECEIVED', 'email', 'en', {}, registry),
    );
    expect(error.channel).toBe('email');
    expect(error.reason).toContain('target');
  });

  it('fails an e-mail that needs the web app address when none is given', () => {
    const error = failure(() => render('TEST_MESSAGE', 'email', 'en', {}));
    expect(error.reason).toContain('app');
  });

  it('fails a placeholder the template does not declare', () => {
    const registry = lineTemplate('Hi {ghost}', {});
    const error = failure(() =>
      render('QUOTE_RECEIVED', 'bell', 'en', { ghost: 'x' }, registry),
    );
    expect(error.reason).toContain('ghost');
  });
});

describe('substitution', () => {
  const two = lineTemplate('{a} and {b}', { a: 'text', b: 'text' });
  const bell = (params: Record<string, unknown>) =>
    render('QUOTE_RECEIVED', 'bell', 'en', params, two);

  it('does not substitute inside a substituted value', () => {
    expect(bell({ a: '{b}', b: 'X' })).toBe('{b} and X');
    expect(bell({ a: '{nope}', b: 'X' })).toBe('{nope} and X');
  });

  it.each(['$&', '$1', '$$', '$`', "$'"])(
    'keeps the value %s literal',
    (value) => {
      expect(bell({ a: value, b: 'X' })).toBe(`${value} and X`);
    },
  );

  it('keeps unicode beyond the basic plane intact', () => {
    expect(bell({ a: '🚗 Škoda', b: 'ț' })).toBe('🚗 Škoda and ț');
  });

  it('handles a ten-thousand-character value', () => {
    const long = 'a'.repeat(10_000);
    expect(bell({ a: long, b: 'X' })).toBe(`${long} and X`);
  });

  it('does not modify its params and is repeatable', () => {
    const params = Object.freeze({ a: 'one', b: 'two' });
    const first = bell(params);
    expect(bell(params)).toBe(first);
    expect(params).toEqual({ a: 'one', b: 'two' });
  });
});

describe('e-mail escaping and layout', () => {
  const hostile = '<b>"x" & \'y\'</b>';
  const registry = registryWith({
    email: {
      en: mail('Hi {name}', ['Dear {name}']),
      ro: mail('Salut {name}', ['Dragă {name}']),
    },
    values: { name: 'text' },
  });
  const rendered = render(
    'QUOTE_RECEIVED',
    'email',
    'en',
    { app: APP, name: hostile },
    registry,
  );

  it('escapes markup in the HTML part', () => {
    expect(rendered.html).not.toContain('<b>"x"');
    expect(rendered.html).not.toContain('</b>');
    expect(rendered.html).toContain('&lt;b&gt;');
    expect(rendered.html).toContain('&amp;');
  });

  it('leaves the value as written in the text part and the subject', () => {
    expect(rendered.text).toContain(`Dear ${hostile}`);
    expect(rendered.subject).toBe(`Hi ${hostile}`);
  });

  it('cannot be broken out of the button link attribute', () => {
    const linked = registryWith({
      email: {
        en: mail('S', ['x'], 'target'),
        ro: mail('S', ['x'], 'target'),
      },
      values: { target: 'link' },
    });
    const html = render(
      'QUOTE_RECEIVED',
      'email',
      'en',
      { target: 'https://m.fx/?a=1&b="><script>alert(1)</script>' },
      linked,
    ).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('has the wordmark, the link and the reason in both parts', () => {
    const out = render('TEST_MESSAGE', 'email', 'en', { app: APP });
    expect(out.html).toContain('MotorFix');
    expect(out.html).toContain(APP);
    expect(out.text).toContain(APP);
    expect(out.html).toContain('a MotorFix admin sent a test message');
    expect(out.text).toContain('a MotorFix admin sent a test message');
  });

  it('carries no unsubscribe link in any shipped e-mail but news', () => {
    for (const [name, template] of Object.entries(TEMPLATES)) {
      if (!template.email || name === 'NEWS') continue;
      for (const language of ['ro', 'en']) {
        const out = render(name, 'email', language, {
          ...template.example,
          app: APP,
          count: 3,
          link: `${APP}/x`,
        });
        expect(`${out.html}\n${out.text}`).not.toMatch(/unsubscribe|dezabon/i);
      }
    }
  });

  it('writes no cedilla in any shipped text', () => {
    const params = { app: APP, count: 3, link: `${APP}/x` };
    const outputs = Object.entries(TEMPLATES).flatMap(([name, template]) => {
      const values = { ...template.example, ...params };
      return [
        ...(template.email ? [render(name, 'email', 'ro', values)] : []),
        ...(template.bell ? [render(name, 'bell', 'ro', values)] : []),
      ];
    });
    expect(JSON.stringify(outputs)).not.toMatch(/[ŞşŢţ]/);
  });

  it('renders en in English', () => {
    expect(render('TEST_MESSAGE', 'bell', 'en', {})).toBe(
      'Test message: notifications work.',
    );
  });

  it('answers Romanian for a language that is not text at all', () => {
    expect(
      render('TEST_MESSAGE', 'bell', undefined as unknown as string, {}),
    ).toBe('Mesaj de test: notificările funcționează.');
    expect(render('TEST_MESSAGE', 'bell', null as unknown as string, {})).toBe(
      'Mesaj de test: notificările funcționează.',
    );
  });

  it('fails when a template has no text in the language asked for', () => {
    const registry = registryWith({ bell: { ro: 'Doar română' } });
    const error = failure(() =>
      render('QUOTE_RECEIVED', 'bell', 'en', {}, registry),
    );
    expect(error.reason).toContain('en');
  });
});

describe('types without a template', () => {
  it.each(['UNKNOWN_TYPE', '', 'constructor', '__proto__', 'toString'])(
    'renders the generic bell and e-mail for %j',
    (name) => {
      expect(render(name, 'bell', 'en', {})).toBe(
        'You have a new notification',
      );
      expect(render(name, 'email', 'ro', { app: APP }).subject).toBe(
        'Ai o notificare nouă',
      );
    },
  );

  it('renders the generic grouped e-mail for an unknown grouped type', () => {
    expect(
      render('SOMETHING_NEW.grouped', 'email', 'en', { app: APP, count: 5 })
        .subject,
    ).toBe('You have 5 new notifications');
    expect(
      render('SOMETHING_NEW.grouped', 'email', 'ro', { app: APP, count: 25 })
        .subject,
    ).toBe('Ai 25 de notificări noi');
  });

  it.each(['push', 'sms', 'whatsapp'] as const)(
    'fails on %s instead of falling back to the generic text',
    (channel) => {
      const error = failure(() => render('UNKNOWN_TYPE', channel, 'en', {}));
      expect(error.channel).toBe(channel);
      expect(error.template).toBe('UNKNOWN_TYPE');
    },
  );

  it('lists the five channels', () => {
    expect([...CHANNELS].sort()).toEqual(
      ['bell', 'email', 'push', 'sms', 'whatsapp'].sort(),
    );
  });
});

describe('push limits', () => {
  const pushWith = (title: string, body: string, link = 'link') =>
    registryWith({
      push: {
        en: { body, link, title },
        ro: { body, link, title },
      },
      values: { link: 'link', t: 'text' },
    });
  const push = (registry: Record<string, Template>, params = {}) =>
    render(
      'QUOTE_RECEIVED',
      'push',
      'en',
      { link: `${APP}/q`, ...params },
      registry,
    );

  it('accepts a 50-character title and a 120-character body', () => {
    expect(push(pushWith('x'.repeat(50), 'y'.repeat(120)))).toEqual({
      body: 'y'.repeat(120),
      link: `${APP}/q`,
      title: 'x'.repeat(50),
    });
  });

  it('rejects a 51-character title', () => {
    expect(failure(() => push(pushWith('x'.repeat(51), 'b'))).channel).toBe(
      'push',
    );
  });

  it('rejects a 121-character body', () => {
    expect(failure(() => push(pushWith('t', 'y'.repeat(121)))).channel).toBe(
      'push',
    );
  });

  it('measures the title after the values are filled in', () => {
    const registry = pushWith('{t}', 'b');
    expect(push(registry, { t: 'x'.repeat(50) }).title).toHaveLength(50);
    failure(() => push(registry, { t: 'x'.repeat(51) }));
  });

  it('counts a Romanian diacritic as one character', () => {
    expect(push(pushWith('ț'.repeat(50), 'ă'.repeat(120))).title).toBe(
      'ț'.repeat(50),
    );
  });

  it('fails when the link value is not supplied', () => {
    const error = failure(() =>
      render('QUOTE_RECEIVED', 'push', 'en', {}, pushWith('t', 'b')),
    );
    expect(error.reason).toContain('link');
  });
});

describe('sms limit', () => {
  const sms = (text: string, v = '') =>
    render(
      'QUOTE_RECEIVED',
      'sms',
      'ro',
      { v },
      registryWith({ sms: { en: text, ro: text }, values: { v: 'text' } }),
    );

  it('accepts exactly 70 characters', () => {
    expect(sms('a'.repeat(70))).toBe('a'.repeat(70));
    expect(sms('ș'.repeat(70))).toBe('ș'.repeat(70));
  });

  it('rejects 71 characters', () => {
    expect(failure(() => sms('a'.repeat(71))).channel).toBe('sms');
  });

  it('counts the filled-in value, not the placeholder', () => {
    expect(sms('{v}', 'a'.repeat(70))).toHaveLength(70);
    failure(() => sms('{v}', 'a'.repeat(71)));
  });
});

describe('whatsapp output', () => {
  const wa = (name: string, slots: string[], params: Record<string, unknown>) =>
    render(
      'QUOTE_RECEIVED',
      'whatsapp',
      'en',
      params,
      registryWith({
        values: { a: 'text', b: 'text', n: 'num' },
        whatsapp: { en: { name, slots }, ro: { name, slots } },
      }),
    );

  it('names the template and fills the slots in order', () => {
    expect(wa('quote_en', ['{b}', '{a}', 'fixed'], { a: '1', b: '2' })).toEqual(
      { name: 'quote_en', params: ['2', '1', 'fixed'] },
    );
  });

  it('gives every parameter as a string', () => {
    const out = wa('q', ['{n}'], { n: 5 });
    expect(out.params).toEqual(['5']);
    expect(typeof out.params[0]).toBe('string');
  });
});

describe('name and bell helpers', () => {
  it('names the account e-mail by purpose', () => {
    expect(templateName('ACCOUNT_EMAIL', { purpose: 'password_reset' })).toBe(
      'ACCOUNT_EMAIL.password_reset',
    );
    expect(templateName('ACCOUNT_EMAIL', { purpose: 'email_check' })).toBe(
      'ACCOUNT_EMAIL.email_check',
    );
  });

  it.each([
    {},
    { purpose: null },
    { purpose: 'other' },
    { purpose: 7 },
    { purpose: '__proto__' },
  ])('names the e-mail check for the purpose %j', (params) => {
    expect(templateName('ACCOUNT_EMAIL', params)).toBe(
      'ACCOUNT_EMAIL.email_check',
    );
  });

  it('leaves every other kind alone, purpose or not', () => {
    expect(templateName('TEST_MESSAGE', { purpose: 'password_reset' })).toBe(
      'TEST_MESSAGE',
    );
    expect(templateName('account_email', {})).toBe('account_email');
    expect(templateName('', {})).toBe('');
  });

  it('renders the account e-mail through its purpose', () => {
    expect(
      render(
        templateName('ACCOUNT_EMAIL', { purpose: 'password_reset' }),
        'bell',
        'en',
        {},
      ),
    ).toBe('You asked to reset your password.');
    expect(
      render(templateName('ACCOUNT_EMAIL', {}), 'email', 'ro', {
        link: `${APP}/t`,
      }).subject,
    ).toBe('Confirmă adresa de e-mail');
  });

  it('gives the bell text of a known type', () => {
    expect(bellText('TEST_MESSAGE', 'en', {})).toBe(
      'Test message: notifications work.',
    );
    expect(bellText('ACCOUNT_EMAIL', 'ro', { purpose: 'password_reset' })).toBe(
      'Ai cerut resetarea parolei.',
    );
  });

  it('gives the generic text for an unknown kind in the language asked', () => {
    expect(bellText('NO_SUCH', 'en', {})).toBe('You have a new notification');
    expect(bellText('NO_SUCH', 'ro', {})).toBe('Ai o notificare nouă');
    expect(bellText('NO_SUCH', 'de', {})).toBe('Ai o notificare nouă');
  });

  it('never throws when the template cannot render', () => {
    const broken = registryWith({
      bell: { en: 'Hi {missing}', ro: 'Salut {missing}' },
    });
    expect(bellText('QUOTE_RECEIVED', 'en', {}, broken)).toBe(
      'You have a new notification',
    );
    expect(bellText('QUOTE_RECEIVED', 'ro', {}, broken)).toBe(
      'Ai o notificare nouă',
    );
  });

  it('never throws when the language, kind or params are hostile', () => {
    expect(bellText('TEST_MESSAGE', undefined as unknown as string, {})).toBe(
      'Mesaj de test: notificările funcționează.',
    );
    expect(bellText(undefined as unknown as string, 'en', {})).toBe(
      'You have a new notification',
    );
    expect(
      bellText(
        'ACCOUNT_EMAIL',
        'en',
        null as unknown as Record<string, unknown>,
      ),
    ).toBe('Confirm your e-mail address.');
  });

  it('gives the generic text when the template has one language only', () => {
    const half = registryWith({ bell: { ro: 'Doar română' } });
    expect(bellText('QUOTE_RECEIVED', 'en', {}, half)).toBe(
      'You have a new notification',
    );
  });
});
