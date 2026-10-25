import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const link = 'https://motorfix.test/app/garage/requests';
const base = { car: 'Dacia Logan', driver: 'Andrei M.', link };
const CHANNELS = ['bell', 'email', 'push', 'whatsapp'] as const;

// @traces 223-FR-003 223-FR-005 223-FR-011 223-FR-015
describe('REQUEST_CANCELLED wording by reason', () => {
  it.each([
    ['account_closed', 'Cererea a fost închisă'],
    ['cancelled', 'Andrei M. a anulat cererea'],
    ['expired', 'Andrei M. a anulat cererea'],
    ['', 'Andrei M. a anulat cererea'],
    ['ACCOUNT_CLOSED', 'Andrei M. a anulat cererea'],
    ['account_closed ', 'Andrei M. a anulat cererea'],
    ['constructor', 'Andrei M. a anulat cererea'],
    ['__proto__', 'Andrei M. a anulat cererea'],
  ])('reason %j reads %s in the bell', (reason, text) => {
    expect(bellText('REQUEST_CANCELLED', 'ro', { ...base, reason })).toContain(
      text,
    );
  });

  it.each([null, undefined, 7, {}, ['account_closed']])(
    'a non-string reason %j falls to the driver wording',
    (reason) => {
      expect(
        bellText('REQUEST_CANCELLED', 'en', {
          ...base,
          reason,
        } as never),
      ).toBe('Andrei M. cancelled the request · Dacia Logan');
    },
  );

  it('renders the closed wording without any driver value', () => {
    const params = { car: 'Dacia Logan', link, reason: 'account_closed' };
    expect(bellText('REQUEST_CANCELLED', 'en', params)).toBe(
      'The request was closed · Dacia Logan',
    );
    expect(
      render('REQUEST_CANCELLED.account_closed', 'push', 'en', params).title,
    ).toBe('Request closed');
  });

  it('falls back to the generic bell text when the driver is missing from the driver wording', () => {
    expect(
      bellText('REQUEST_CANCELLED', 'en', { car: 'Dacia Logan', link }),
    ).toBe(bellText('NO_SUCH_KIND', 'en', {}));
  });

  it('falls back to Romanian for an unknown language', () => {
    expect(
      bellText('REQUEST_CANCELLED', 'fr', {
        ...base,
        reason: 'account_closed',
      }),
    ).toBe('Cererea a fost închisă · Dacia Logan');
  });

  it('keeps a hostile driver name as text in the e-mail html', () => {
    const mail = render('REQUEST_CANCELLED', 'email', 'en', {
      ...base,
      driver: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('refuses a javascript: link in the e-mail', () => {
    expect(() =>
      render('QUOTE_LOST', 'email', 'en', {
        car: 'Dacia Logan',
        link: 'javascript:alert(1)',
      }),
    ).toThrow();
  });

  it('passes the template check for every new key', () => {
    for (const key of [
      'QUOTE_LOST',
      'REQUEST_CANCELLED',
      'REQUEST_CANCELLED.account_closed',
    ]) {
      expect(TEMPLATES[key]).toBeDefined();
      expect(checkTemplates({ [key]: TEMPLATES[key] })).toEqual([]);
    }
  });

  it('declares no plate or phone value in any new key', () => {
    for (const key of [
      'QUOTE_LOST',
      'REQUEST_CANCELLED',
      'REQUEST_CANCELLED.account_closed',
    ]) {
      expect(Object.keys(TEMPLATES[key]?.values ?? {})).not.toEqual(
        expect.arrayContaining(['plate']),
      );
      expect(Object.keys(TEMPLATES[key]?.values ?? {})).not.toEqual(
        expect.arrayContaining(['phone']),
      );
      expect(JSON.stringify(TEMPLATES[key])).not.toMatch(/plate|phone|sms/i);
    }
  });

  it('never leaks an extra plate param into any rendered channel', () => {
    const params = { ...base, phone: '+40712345678', plate: 'B123ABC' };
    for (const kind of [
      'QUOTE_LOST',
      'REQUEST_CANCELLED',
      'REQUEST_CANCELLED.account_closed',
    ]) {
      for (const channel of CHANNELS) {
        for (const lang of ['ro', 'en']) {
          const out = JSON.stringify(render(kind, channel, lang, params));
          expect(out).not.toContain('B123ABC');
          expect(out).not.toContain('+40712345678');
        }
      }
    }
  });

  it('has no SMS text in any new key', () => {
    for (const key of [
      'QUOTE_LOST',
      'REQUEST_CANCELLED',
      'REQUEST_CANCELLED.account_closed',
    ]) {
      expect(() => render(key, 'sms', 'en', base)).toThrow();
    }
  });

  it('writes every channel in English for en and Romanian for ro', () => {
    for (const kind of ['QUOTE_LOST', 'REQUEST_CANCELLED']) {
      const ro = JSON.stringify(
        CHANNELS.map((c) => render(kind, c, 'ro', base)),
      );
      const en = JSON.stringify(
        CHANNELS.map((c) => render(kind, c, 'en', base)),
      );
      expect(ro).not.toEqual(en);
      expect(en).not.toMatch(/Clientul|anulat|service\b.*ales/);
    }
  });

  it('renders a car name with unicode and braces literally', () => {
    expect(
      bellText('QUOTE_LOST', 'en', { car: 'Škoda {link} Fabia', link }),
    ).toBe('The customer chose another garage · Škoda {link} Fabia');
  });

  it('falls back to the generic bell text when the quote lost car is missing', () => {
    expect(bellText('QUOTE_LOST', 'en', { link })).toBe(
      bellText('NO_SUCH_KIND', 'en', {}),
    );
  });
});
