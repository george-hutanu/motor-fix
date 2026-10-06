import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const link = 'https://motorfix.test/ro/invite/abc';
const app = 'https://motorfix.test';

describe('staff templates', () => {
  it('passes the template check', () => {
    const staff = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith('STAFF_')),
    );

    expect(Object.keys(staff).sort()).toEqual([
      'STAFF_INVITE.mechanic',
      'STAFF_INVITE.receptionist',
      'STAFF_JOINED',
    ]);
    expect(checkTemplates(staff)).toEqual([]);
  });

  it('invites a mechanic in Romanian, naming the garage, with the link as the button', () => {
    const mail = render('STAFF_INVITE.mechanic', 'email', 'ro', {
      app,
      garage: 'Atelier Dinamo',
      link,
    });

    expect(mail.subject).toContain('Atelier Dinamo');
    expect(mail.text).toContain('ca mecanic');
    expect(mail.text).toContain(link);
  });

  it('invites a receptionist in English', () => {
    const mail = render('STAFF_INVITE.receptionist', 'email', 'en', {
      app,
      garage: 'Atelier Dinamo',
      link,
    });

    expect(mail.text).toContain('as a receptionist');
    expect(mail.text).toContain(link);
  });

  it('never shows a typed garage name back as markup', () => {
    const mail = render('STAFF_INVITE.mechanic', 'email', 'en', {
      app,
      garage: '<b>Dinamo</b>',
      link,
    });

    expect(mail.html).not.toContain('<b>Dinamo</b>');
    expect(mail.html).toContain('&lt;b&gt;Dinamo&lt;/b&gt;');
  });

  it('tells the owner who joined, in the bell and the e-mail', () => {
    const params = { app, garage: 'Atelier Dinamo', name: 'Elena Stan' };

    expect(render('STAFF_JOINED', 'bell', 'ro', params)).toContain(
      'Elena Stan',
    );
    expect(render('STAFF_JOINED', 'email', 'en', params).text).toContain(
      'Elena Stan',
    );
  });
});
