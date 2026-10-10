// @traces 195-FR-001 195-FR-002 195-FR-003 195-FR-004 195-FR-006 195-FR-007 195-FR-008 195-FR-010 195-FR-011
import {
  bellText,
  render,
  type Template,
  TemplateError,
  templateName,
} from './templates';
import { TEMPLATES } from './templates/registry';

const APP = 'https://motorfix.test';

const fixture = (template: Partial<Template>): Record<string, Template> => ({
  ...TEMPLATES,
  QUOTE_RECEIVED: {
    audience: 'driver',
    example: {},
    values: {},
    ...template,
  },
});

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a TemplateError');
};

describe('the test message', () => {
  it('is in English for an English account: subject, body and bell', () => {
    const mail = render('TEST_MESSAGE', 'email', 'en', { app: APP });
    expect(mail.subject).toBe('MotorFix test message');
    expect(mail.text).toContain('This is a test message from MotorFix.');
    expect(mail.html).toContain('This is a test message from MotorFix.');
    expect(render('TEST_MESSAGE', 'bell', 'en', {})).toBe(
      'Test message: notifications work.',
    );
  });

  it('is in Romanian, with ș and ț written with the comma below', () => {
    const mail = render('TEST_MESSAGE', 'email', 'ro', { app: APP });
    expect(mail.subject).toBe('Mesaj de test MotorFix');
    expect(mail.text).toContain('Primești');
    expect(mail.html).toContain('Primești');
    const bell = render('TEST_MESSAGE', 'bell', 'ro', {});
    expect(bell).toBe('Mesaj de test: notificările funcționează.');
    for (const text of [mail.subject, mail.text, mail.html, bell]) {
      expect(text).not.toMatch(/[ŞşŢţ]/);
    }
  });

  it('is in Romanian when the language is neither ro nor en', () => {
    expect(render('TEST_MESSAGE', 'email', 'de', { app: APP }).subject).toBe(
      'Mesaj de test MotorFix',
    );
    expect(render('TEST_MESSAGE', 'bell', '', {})).toBe(
      'Mesaj de test: notificările funcționează.',
    );
  });

  it('has an HTML and a plain-text part whose one button opens the app', () => {
    const mail = render('TEST_MESSAGE', 'email', 'en', { app: APP });
    expect(mail.html).toMatch(/^<!doctype html>/i);
    expect(mail.html.match(/<a /g)).toHaveLength(1);
    expect(mail.html).toContain(`href="${APP}"`);
    expect(mail.html).toContain('Open MotorFix');
    expect(mail.text).toContain(`Open MotorFix: ${APP}`);
    expect(mail.html).toContain('>MotorFix</td>');
  });

  it('says why the person gets it and carries no unsubscribe link', () => {
    const mail = render('TEST_MESSAGE', 'email', 'en', { app: APP });
    expect(mail.text).toContain('You get this e-mail because');
    expect(mail.html).toContain('You get this e-mail because');
    expect(`${mail.text}${mail.html}`).not.toMatch(/unsubscribe|dezabon/i);
  });
});

// @traces 127-FR-008
describe('the account e-mails', () => {
  const link = 'https://motorfix.test/reset?t=a&b=<x>';

  it.each([
    ['email_check', 'en', 'Confirm your e-mail address'],
    ['email_check', 'ro', 'Confirmă adresa de e-mail'],
    ['password_reset', 'en', 'Reset your password'],
    ['password_reset', 'ro', 'Resetează parola'],
    ['password_changed', 'en', 'Your password was changed'],
    ['password_changed', 'ro', 'Parola ta a fost schimbată'],
  ])(
    'writes the %s e-mail in %s with the link as its button',
    (purpose, language, subject) => {
      const name = templateName('ACCOUNT_EMAIL', { purpose });
      const mail = render(name, 'email', language, { link });
      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(
        'href="https://motorfix.test/reset?t=a&amp;b=&lt;x&gt;"',
      );
      expect(mail.html.match(/<a /g)).toHaveLength(1);
    },
  );

  it('gives each purpose its own reason in the footer', () => {
    const check = render('ACCOUNT_EMAIL.email_check', 'email', 'en', { link });
    const reset = render('ACCOUNT_EMAIL.password_reset', 'email', 'en', {
      link,
    });
    expect(check.text).toContain('You get this e-mail because');
    expect(reset.text).toContain('You get this e-mail because');
    expect(check.text).not.toBe(reset.text);
  });

  it('tells the holder of a changed password to reset it if it was not them', () => {
    const en = render('ACCOUNT_EMAIL.password_changed', 'email', 'en', {
      link,
    });
    const ro = render('ACCOUNT_EMAIL.password_changed', 'email', 'ro', {
      link,
    });
    expect(en.text).toContain('If it was not you');
    expect(ro.text).toContain('Dacă nu ai fost tu');
    expect(en.text).not.toContain('ignore it');
  });

  it('names the e-mail check for an unknown purpose, as the sender does', () => {
    expect(templateName('ACCOUNT_EMAIL', {})).toBe('ACCOUNT_EMAIL.email_check');
    expect(templateName('ACCOUNT_EMAIL', { purpose: 'password_reset' })).toBe(
      'ACCOUNT_EMAIL.password_reset',
    );
    expect(templateName('ACCOUNT_EMAIL', { purpose: 'password_changed' })).toBe(
      'ACCOUNT_EMAIL.password_changed',
    );
    expect(templateName('QUOTE_RECEIVED', { purpose: 'x' })).toBe(
      'QUOTE_RECEIVED',
    );
  });
});

// @traces 209-FR-005
describe('the verification result variant', () => {
  it.each(['approved', 'more_requested', 'rejected'])(
    'picks VERIFICATION_RESULT.%s by the decision',
    (decision) => {
      expect(templateName('VERIFICATION_RESULT', { decision })).toBe(
        `VERIFICATION_RESULT.${decision}`,
      );
    },
  );

  it.each([
    [{}],
    [{ decision: 'reopened' }],
    [{ decision: 'constructor' }],
    [{ decision: null }],
  ])('keeps the bare kind for %j', (params) => {
    expect(templateName('VERIFICATION_RESULT', params)).toBe(
      'VERIFICATION_RESULT',
    );
  });

  it('leaves another kind with a decision alone', () => {
    expect(templateName('QUOTE_RECEIVED', { decision: 'approved' })).toBe(
      'QUOTE_RECEIVED',
    );
  });
});

describe('grouped e-mails', () => {
  it('names the count of new quotes in both languages', () => {
    expect(
      render('QUOTE_RECEIVED.grouped', 'email', 'en', { app: APP, count: 3 })
        .subject,
    ).toBe('3 new quotes');
    expect(
      render('QUOTE_RECEIVED.grouped', 'email', 'ro', { app: APP, count: 3 })
        .subject,
    ).toBe('3 oferte noi');
  });

  it.each([
    [0, '0 oferte noi'],
    [2, '2 oferte noi'],
    [19, '19 oferte noi'],
    [20, '20 de oferte noi'],
    [99, '99 de oferte noi'],
    [100, '100 de oferte noi'],
    [101, '101 oferte noi'],
    [119, '119 oferte noi'],
    [120, '120 de oferte noi'],
  ])('writes %i in Romanian as "%s"', (count, subject) => {
    expect(
      render('QUOTE_RECEIVED.grouped', 'email', 'ro', { app: APP, count })
        .subject,
    ).toBe(subject);
  });

  it('uses the generic grouped e-mail for a type that has none', () => {
    expect(
      render('MESSAGE_RECEIVED.grouped', 'email', 'en', { app: APP, count: 4 })
        .subject,
    ).toBe('You have 4 new notifications');
    expect(
      render('MESSAGE_RECEIVED.grouped', 'email', 'ro', { app: APP, count: 25 })
        .subject,
    ).toBe('Ai 25 de notificări noi');
  });
});

describe('a type with no template yet', () => {
  it('sends the generic e-mail and bell text in the person language', () => {
    expect(
      render('BOOKING_CONFIRMED', 'email', 'en', { app: APP }).subject,
    ).toBe('You have a new notification');
    expect(render('BOOKING_CONFIRMED', 'bell', 'ro', {})).toBe(
      'Ai o notificare nouă',
    );
  });

  it('has no generic push, SMS or WhatsApp text', () => {
    const error = failure(() => render('BOOKING_CONFIRMED', 'push', 'en', {}));
    expect(error).toBeInstanceOf(TemplateError);
    expect(error).toMatchObject({
      channel: 'push',
      template: 'BOOKING_CONFIRMED',
    });
  });
});

describe('values in a template', () => {
  const priced = fixture({
    bell: {
      en: 'Quote {range} for {at}, {n} km',
      ro: 'Ofertă {range} pentru {at}, {n} km',
    },
    example: { at: '2026-11-03T12:30:00Z', n: 1, range: [1, 2] },
    values: { at: 'when', n: 'num', range: 'lei' },
  });

  it('writes a price range and a booking time in the format of each language', () => {
    const params = {
      at: '2026-11-03T12:30:00Z',
      n: 12500,
      range: [125000, 160000],
    };
    expect(render('QUOTE_RECEIVED', 'bell', 'ro', params, priced)).toBe(
      'Ofertă 1.250–1.600 lei pentru 3 nov. 2026, 14:30, 12.500 km',
    );
    expect(render('QUOTE_RECEIVED', 'bell', 'en', params, priced)).toBe(
      'Quote 1,250–1,600 lei for 3 Nov 2026, 14:30, 12,500 km',
    );
  });

  it('writes one price, and a range whose ends are equal as one price', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'bell',
        'ro',
        { at: 0, n: 0, range: 125000 },
        priced,
      ),
    ).toContain('1.250 lei');
    expect(
      render(
        'QUOTE_RECEIVED',
        'bell',
        'en',
        { at: 0, n: 0, range: [125000, 125000] },
        priced,
      ),
    ).toContain('Quote 1,250 lei for');
  });

  it('writes the local Bucharest time on the night summer time ends', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'bell',
        'en',
        { at: '2026-10-25T01:30:00Z', n: 0, range: 0 },
        priced,
      ),
    ).toContain('25 Oct 2026, 03:30');
  });

  it('shows the dash for a value that is not a number or an instant', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'bell',
        'en',
        { at: 'soon', n: 'many', range: 'cheap' },
        priced,
      ),
    ).toBe('Quote — for —, — km');
  });

  it.each([undefined, null])(
    'does not render with a value that is %s',
    (value) => {
      const error = failure(() =>
        render(
          'QUOTE_RECEIVED',
          'bell',
          'en',
          { at: value, n: 1, range: 1 },
          priced,
        ),
      );
      expect(error).toBeInstanceOf(TemplateError);
      expect(error).toMatchObject({
        channel: 'bell',
        reason: 'missing value at',
        template: 'QUOTE_RECEIVED',
      });
    },
  );

  it('does not render a placeholder the template does not declare', () => {
    const loose = fixture({ bell: { en: 'Hi {who}', ro: 'Salut {who}' } });
    expect(
      failure(() =>
        render('QUOTE_RECEIVED', 'bell', 'en', { who: 'Ana' }, loose),
      ),
    ).toMatchObject({ reason: 'undeclared value who' });
  });

  it('escapes values in the HTML part only', () => {
    const named = fixture({
      email: {
        en: {
          button: { label: 'Open', link: 'app' },
          lines: ['From {garage}'],
          reason: 'Because.',
          subject: 'From {garage}',
        },
        ro: {
          button: { label: 'Deschide', link: 'app' },
          lines: ['De la {garage}'],
          reason: 'Pentru că.',
          subject: 'De la {garage}',
        },
      },
      values: { garage: 'text' },
    });
    const mail = render(
      'QUOTE_RECEIVED',
      'email',
      'en',
      { app: APP, garage: 'Ana & "Fiii" <SRL>' },
      named,
    );
    expect(mail.subject).toBe('From Ana & "Fiii" <SRL>');
    expect(mail.text).toContain('From Ana & "Fiii" <SRL>');
    expect(mail.html).toContain('From Ana &amp; &quot;Fiii&quot; &lt;SRL&gt;');
    expect(mail.html).not.toContain('<SRL>');
  });
});

describe('push, SMS and WhatsApp', () => {
  const channels = fixture({
    example: { link: 'https://m.fx/q/1' },
    push: {
      en: { body: 'Open it to compare.', link: 'link', title: 'New quote' },
      ro: {
        body: 'Deschide ca să compari.',
        link: 'link',
        title: 'Ofertă nouă',
      },
    },
    sms: { en: 'New quote: {link}', ro: 'Ofertă nouă: {link}' },
    values: { garage: 'text', link: 'link' },
    whatsapp: {
      en: { name: 'quote_received_en', slots: ['{garage}', '{link}'] },
      ro: { name: 'quote_received_ro', slots: ['{garage}', '{link}'] },
    },
  });

  it('gives a push its title, body and the link that opens the screen', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'push',
        'ro',
        { link: 'https://m.fx/q/1' },
        channels,
      ),
    ).toEqual({
      body: 'Deschide ca să compari.',
      link: 'https://m.fx/q/1',
      title: 'Ofertă nouă',
    });
  });

  it('gives an SMS its text with the link in it', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'sms',
        'ro',
        { link: 'https://m.fx/q/1' },
        channels,
      ),
    ).toBe('Ofertă nouă: https://m.fx/q/1');
  });

  it('gives WhatsApp the approved template name and its slots in order', () => {
    expect(
      render(
        'QUOTE_RECEIVED',
        'whatsapp',
        'en',
        { garage: 'Auto Ion', link: 'https://m.fx/q/1' },
        channels,
      ),
    ).toEqual({
      name: 'quote_received_en',
      params: ['Auto Ion', 'https://m.fx/q/1'],
    });
  });

  it.each([
    [
      'push',
      'push title over 50 characters',
      { body: 'b', link: 'link', title: 'x'.repeat(51) },
    ],
    [
      'push',
      'push body over 120 characters',
      { body: 'x'.repeat(121), link: 'link', title: 't' },
    ],
  ] as const)('does not render a %s with a %s', (_channel, reason, text) => {
    const long = fixture({
      push: { en: text, ro: text },
      values: { link: 'link' },
    });
    expect(
      failure(() =>
        render('QUOTE_RECEIVED', 'push', 'en', { link: 'https://m.fx' }, long),
      ),
    ).toMatchObject({ reason });
  });

  it('does not render an SMS over 70 characters, link included', () => {
    const long = fixture({
      sms: { en: `${'x'.repeat(50)} {link}`, ro: `${'ș'.repeat(50)} {link}` },
      values: { link: 'link' },
    });
    const params = { link: 'https://motorfix.test/q/123' };
    expect(
      failure(() => render('QUOTE_RECEIVED', 'sms', 'ro', params, long)),
    ).toMatchObject({ reason: 'sms over 70 characters' });
  });
});

describe('the bell text', () => {
  it('is the template text in the language asked for', () => {
    expect(bellText('TEST_MESSAGE', 'en', {})).toBe(
      'Test message: notifications work.',
    );
    expect(bellText('ACCOUNT_EMAIL', 'ro', { purpose: 'password_reset' })).toBe(
      'Ai cerut resetarea parolei.',
    );
  });

  it('is the generic text when the template cannot render', () => {
    const priced = fixture({
      bell: { en: 'Quote {range}', ro: 'Ofertă {range}' },
      example: { range: 1 },
      values: { range: 'lei' },
    });
    expect(bellText('QUOTE_RECEIVED', 'en', {}, priced)).toBe(
      'You have a new notification',
    );
    expect(bellText('QUOTE_RECEIVED', 'ro', {}, priced)).toBe(
      'Ai o notificare nouă',
    );
  });
});

describe('the push texts of the test messages', () => {
  it.each([
    ['TEST_MESSAGE', 'en', 'MotorFix test message'],
    ['TEST_MESSAGE', 'ro', 'Mesaj de test MotorFix'],
    ['PUSH_TEST', 'en', 'MotorFix test notification'],
    ['PUSH_TEST', 'ro', 'Notificare de test MotorFix'],
  ])('writes %s in %s with the app link', (name, language, title) => {
    const push = render(name, 'push', language, { app: APP });
    expect(push.title).toBe(title);
    expect(push.link).toBe(APP);
    expect(push.body.length).toBeGreaterThan(0);
  });

  it('writes a bell text for the push-only test', () => {
    expect(render('PUSH_TEST', 'bell', 'en', {})).toMatch(/test/i);
    expect(render('PUSH_TEST', 'bell', 'ro', {})).toMatch(/test/i);
  });

  it('has no push text for a type that never got one', () => {
    expect(() => render('DUE_ITP', 'push', 'en', { app: APP })).toThrow(
      TemplateError,
    );
  });
});

describe('the links an e-mail carries', () => {
  const linked = fixture({
    email: {
      en: {
        button: { label: 'Open', link: 'go' },
        lines: ['Hi'],
        reason: 'Because.',
        stop: { label: 'Stop', link: 'stop' },
        subject: 'Hi',
      },
      ro: {
        button: { label: 'Deschide', link: 'go' },
        lines: ['Salut'],
        reason: 'Pentru că.',
        stop: { label: 'Oprește', link: 'stop' },
        subject: 'Salut',
      },
    },
    values: { go: 'link', stop: 'link' },
  });
  const mail = (go: string, stop: string) =>
    render('QUOTE_RECEIVED', 'email', 'en', { go, stop }, linked);
  const safe = `${APP}/x`;

  it.each([
    'https://motorfix.test/x?t=a&b=<x>',
    'HTTPS://motorfix.ro',
    'http://localhost:4200/x',
    'http://127.0.0.1/x',
    'http://LOCALHOST/x',
    ' https://motorfix.test/x ',
  ])('accepts %s as the button and the stop link', (href) => {
    expect(() => mail(href, safe)).not.toThrow();
    expect(() => mail(safe, href)).not.toThrow();
  });

  it('still escapes an accepted href in the HTML part', () => {
    const html = mail('https://motorfix.test/x?t=a&b=<x>', safe).html;
    expect(html).not.toContain('<x>');
    expect(html).toContain('&amp;');
  });

  it.each([
    'http://motorfix.ro/x',
    'javascript:alert(1)',
    'data:text/html,x',
    '/relative/path',
    'motorfix.ro/x',
    'not a url',
    '',
    'http://localhost.evil.com/x',
    'http://127.0.0.1.evil.com/x',
    'http://[::1]/x',
  ])('refuses %j as the button and the stop link', (href) => {
    const button = failure(() => mail(href, safe));
    expect(button).toBeInstanceOf(TemplateError);
    expect((button as TemplateError).reason).toMatch(/button link/);
    const stop = failure(() => mail(safe, href));
    expect(stop).toBeInstanceOf(TemplateError);
    expect((stop as TemplateError).reason).toMatch(/stop link/);
  });

  it('renders an e-mail with no stop link', () => {
    const plain = fixture({
      email: {
        en: {
          button: { label: 'Open', link: 'go' },
          lines: ['Hi'],
          reason: 'Because.',
          subject: 'Hi',
        },
        ro: {
          button: { label: 'Deschide', link: 'go' },
          lines: ['Salut'],
          reason: 'Pentru că.',
          subject: 'Salut',
        },
      },
      values: { go: 'link' },
    });
    expect(
      render('QUOTE_RECEIVED', 'email', 'en', { go: safe }, plain).html,
    ).toContain(safe);
  });
});
