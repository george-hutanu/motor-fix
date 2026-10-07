import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const link = 'https://motorfix.test/ro/list-your-garage?draft=abc';
const app = 'https://motorfix.test';

describe('listing draft templates', () => {
  it('passes the template check', () => {
    const listing = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith('LISTING_')),
    );

    expect(Object.keys(listing).sort()).toEqual([
      'LISTING_CONTINUE_LINK',
      'LISTING_REMINDER',
    ]);
    expect(checkTemplates(listing)).toEqual([]);
  });

  it.each([
    [
      'LISTING_CONTINUE_LINK',
      'ro',
      'Continuă înscrierea service-ului',
      'Continuă înscrierea',
    ],
    [
      'LISTING_CONTINUE_LINK',
      'en',
      'Continue listing your garage',
      'Continue listing',
    ],
    [
      'LISTING_REMINDER',
      'ro',
      'Ai început să-ți înscrii service-ul',
      'Continuă de unde ai rămas',
    ],
    [
      'LISTING_REMINDER',
      'en',
      'You started listing your garage',
      'Pick up where you left off',
    ],
  ] as const)(
    'writes %s in %s with the link as its button',
    (name, language, subject, button) => {
      const mail = render(name, 'email', language, { app, link });

      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(button);
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(link.replace('&', '&amp;'));
    },
  );

  it('says in English why the address got the e-mail', () => {
    expect(
      render('LISTING_REMINDER', 'email', 'en', { app, link }).text,
    ).toContain(
      'You get this e-mail because this address was given while listing a garage on MotorFix. If it was not you, ignore it.',
    );
  });

  it('writes Romanian with comma-below diacritics only', () => {
    for (const name of ['LISTING_CONTINUE_LINK', 'LISTING_REMINDER']) {
      const { subject, text } = render(name, 'email', 'ro', { app, link });
      expect(`${subject}${text}`).not.toMatch(/[şţŞŢ]/);
      expect(text).toContain(
        'Primești acest e-mail pentru că ai început să înscrii un service pe MotorFix cu această adresă. Dacă nu ai fost tu, ignoră-l.',
      );
    }
  });

  it('refuses to write the e-mail without its link', () => {
    expect(() =>
      render('LISTING_CONTINUE_LINK', 'email', 'en', { app }),
    ).toThrow();
  });
});
