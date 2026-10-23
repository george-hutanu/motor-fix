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
