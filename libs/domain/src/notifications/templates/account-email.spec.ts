import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const params = {
  app: 'https://motorfix.test',
  link: 'https://motorfix.test/ro',
  purpose: 'account_deleted',
};

// @traces 129-FR-012
describe('the account deleted e-mail', () => {
  it('is the template an account e-mail for a deleted account picks', () => {
    expect(templateName('ACCOUNT_EMAIL', params)).toBe(
      'ACCOUNT_EMAIL.account_deleted',
    );
  });

  it('passes the template check', () => {
    const template = TEMPLATES['ACCOUNT_EMAIL.account_deleted'];

    expect(template).toBeDefined();
    expect(
      checkTemplates({ 'ACCOUNT_EMAIL.account_deleted': template }),
    ).toEqual([]);
  });

  it('says the account was deleted, in Romanian', () => {
    const mail = render('ACCOUNT_EMAIL.account_deleted', 'email', 'ro', params);

    expect(mail.subject).toBe('Contul tău a fost șters');
  });

  it('says the account was deleted, in English', () => {
    const mail = render('ACCOUNT_EMAIL.account_deleted', 'email', 'en', params);

    expect(mail.subject).toBe('Your account was deleted');
  });
});

const suspended = {
  app: 'https://motorfix.test',
  link: 'https://motorfix.test/ro/contact',
  purpose: 'account_suspended',
  reason: 'Cereri false <b>repetate</b> către service-uri.',
  support: 'suport@motorfix.test',
};

// @traces 003-FR-022 003-FR-007
describe('the account suspended e-mail', () => {
  it('is the template an account e-mail for a suspension picks', () => {
    expect(templateName('ACCOUNT_EMAIL', suspended)).toBe(
      'ACCOUNT_EMAIL.account_suspended',
    );
  });

  it('passes the template check', () => {
    const template = TEMPLATES['ACCOUNT_EMAIL.account_suspended'];

    expect(template).toBeDefined();
    expect(
      checkTemplates({ 'ACCOUNT_EMAIL.account_suspended': template }),
    ).toEqual([]);
  });

  it.each([
    ['ro', 'Contul tău a fost suspendat', 'Scrie-ne'],
    ['en', 'Your account was suspended', 'Write to us'],
  ])(
    'says the account was suspended in %s, with the reason, the support address and the contact form',
    (language, subject, button) => {
      const mail = render(
        'ACCOUNT_EMAIL.account_suspended',
        'email',
        language,
        suspended,
      );

      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(
        'Cereri false <b>repetate</b> către service-uri.',
      );
      expect(mail.text).toContain('suport@motorfix.test');
      expect(mail.text).toContain('https://motorfix.test/ro/contact');
      expect(mail.html).toContain(button);
      expect(mail.html).toContain('&lt;b&gt;repetate&lt;/b&gt;');
      expect(mail.html).not.toContain('<b>repetate</b>');
    },
  );

  // With no support address configured, the contact page stands in for it.
  it.each([
    [
      'ro',
      'Dacă crezi că e o greșeală, scrie-ne: https://motorfix.test/ro/contact',
    ],
    [
      'en',
      'If you think this is a mistake, write to us: https://motorfix.test/ro/contact',
    ],
  ])(
    'reads naturally in %s with the contact page as the address',
    (language, line) => {
      const mail = render(
        'ACCOUNT_EMAIL.account_suspended',
        'email',
        language,
        {
          ...suspended,
          support: suspended.link,
        },
      );

      expect(mail.text).toContain(line);
      expect(mail.text).not.toMatch(/contact form|formularul de contact/);
    },
  );
});
