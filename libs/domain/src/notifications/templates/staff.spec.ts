import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const link = 'https://motorfix.test/ro/invite/abc';
const app = 'https://motorfix.test';

describe('staff templates', () => {
  // @traces 056-FR-009
  it('passes the template check', () => {
    const staff = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith('STAFF_')),
    );

    expect(Object.keys(staff).sort()).toEqual([
      'STAFF_INVITE.mechanic',
      'STAFF_INVITE.receptionist',
      'STAFF_JOINED',
      'STAFF_REMOVED',
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

  // @traces 131-FR-004 131-FR-013
  it('invites a receptionist in English', () => {
    const mail = render('STAFF_INVITE.receptionist', 'email', 'en', {
      app,
      garage: 'Atelier Dinamo',
      link,
    });

    expect(mail.text).toContain('as a receptionist');
    expect(mail.text).toContain(link);
  });

  // @traces 131-FR-013
  it('never shows a typed garage name back as markup', () => {
    const mail = render('STAFF_INVITE.mechanic', 'email', 'en', {
      app,
      garage: '<b>Dinamo</b>',
      link,
    });

    expect(mail.html).not.toContain('<b>Dinamo</b>');
    expect(mail.html).toContain('&lt;b&gt;Dinamo&lt;/b&gt;');
  });

  // @traces 131-FR-009
  it('tells the owner who joined, in the bell and the e-mail', () => {
    const params = { app, garage: 'Atelier Dinamo', name: 'Elena Stan' };

    expect(render('STAFF_JOINED', 'bell', 'ro', params)).toContain(
      'Elena Stan',
    );
    expect(render('STAFF_JOINED', 'email', 'en', params).text).toContain(
      'Elena Stan',
    );
  });

  // @traces 056-FR-009
  it.each([
    ['ro', 'Nu mai faci parte din echipa Atelier Dinamo.'],
    ['en', 'You are no longer part of the team of Atelier Dinamo.'],
  ])(
    'tells a removed account in %s that it left the team, in the bell, the e-mail and the push',
    (language, line) => {
      const params = { app, garage: 'Atelier Dinamo' };

      expect(render('STAFF_REMOVED', 'bell', language, params)).toBe(line);
      const mail = render('STAFF_REMOVED', 'email', language, params);
      expect(mail.text).toContain(line);
      expect(mail.text).toContain(`: ${app}`);
      expect(mail.html).toContain(`href="${app}"`);
      const push = render('STAFF_REMOVED', 'push', language, params);
      expect(push.body).toContain(line);
      expect(push.link).toBe(app);
      expect(push.title).not.toBe('');
    },
  );
});
