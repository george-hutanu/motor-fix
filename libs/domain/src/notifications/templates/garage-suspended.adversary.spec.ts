import { nextStep } from './garage-suspended';
import { bellLink } from '../bell/bell.link';
import { bellText, render } from '../templates';

const KIND = 'GARAGE_SUSPENDED';
const link = 'https://motorfix.test/app/garage';
const hostile = '<img src=x onerror=alert(1)> "q" & \'s\'';

const params = (language: string, reason = hostile) => ({
  garage: 'Atelier <b>Dinamo</b>',
  link,
  next: nextStep('admin', language),
  reason,
});

// @traces 049-FR-011
describe('the suspension message under hostile input', () => {
  it.each(['', 'fr', 'EN', 'en-GB', '__proto__'])(
    'falls back to Romanian steps for the language %j',
    (language) => {
      expect(nextStep('recheck_failed', language)).toBe(
        language === 'en'
          ? 'upload the renewed RAR authorisation.'
          : 'încarcă autorizația RAR reînnoită.',
      );
    },
  );

  it.each(['', 'unknown', 'constructor', '__proto__', 'toString', 'ADMIN'])(
    'answers the team for the cause %j',
    (cause) => {
      expect(nextStep(cause, 'en')).toBe('answer the MotorFix team.');
      expect(nextStep(cause, 'ro')).toBe('răspunde echipei MotorFix.');
    },
  );

  it.each(['ro', 'en'] as const)(
    'escapes markup in the reason and the garage name in the e-mail in %s',
    (language) => {
      const mail = render(KIND, 'email', language, params(language));
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toContain('<b>Dinamo');
      expect(mail.html).toContain('&lt;img');
    },
  );

  it('keeps a very long reason intact in the bell', () => {
    const reason = 'x'.repeat(200);
    expect(bellText(KIND, 'ro', params('ro', reason))).toContain(reason);
  });

  it('renders a reason with unicode and a dollar pattern verbatim', () => {
    const reason = "$& $1 $' ăîșț 🚗";
    const mail = render(KIND, 'email', 'ro', params('ro', reason));
    expect(mail.text).toContain(`Motiv: ${reason}`);
  });

  it('does not render another language into the e-mail for an unknown one', () => {
    const mail = render(KIND, 'email', 'en', params('en', 'plain'));
    expect(mail.text).not.toContain('Motiv:');
  });
});

// @traces 049-FR-011
describe('the bell link for a suspension', () => {
  it.each([
    [{}],
    [{ link: 'javascript:alert(1)' }],
    [null],
    [undefined],
    [{ link: 'https://evil.test/app/garage' }],
  ])('opens the garage dashboard whatever the params %j', (p) => {
    expect(bellLink({ kind: KIND, params: p, subjectId: null } as never)).toBe(
      '/app/garage',
    );
  });

  it('ignores a subject id', () => {
    expect(
      bellLink({ kind: KIND, params: {}, subjectId: 'car-1' } as never),
    ).toBe('/app/garage');
  });

  it.each(['garage_suspended', 'GARAGE_SUSPENDED ', 'garage-suspended'])(
    'gives no link for the kind %j',
    (kind) => {
      expect(
        bellLink({ kind, params: {}, subjectId: null } as never),
      ).toBeNull();
    },
  );
});
