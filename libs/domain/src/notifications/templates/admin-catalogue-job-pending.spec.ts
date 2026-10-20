import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'ADMIN_CATALOGUE_JOB_PENDING';
const dashboard = 'https://motorfix.test/app/admin';
const params = {
  dashboard,
  garage: 'Service Auto Nord',
  job: 'Recondiționare injectoare',
};

// @traces 1352-catalogue-job-visibility-FR-015
describe('the alert for a job proposed for the catalogue', () => {
  it('goes to the bell, by e-mail and by push, can be muted, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(
      expect.arrayContaining(['email', 'push']),
    );
    expect(NOTIFICATION_TYPES[KIND].alwaysSent).toBe(false);
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it.each([
    ['ro', 'Service Auto Nord a propus lucrarea „Recondiționare injectoare”'],
    ['en', 'Service Auto Nord proposed the job "Recondiționare injectoare"'],
  ])('reads in the bell in %s', (language, line) => {
    expect(render(KIND, 'bell', language, params)).toBe(line);
  });

  it.each([
    ['ro', 'Deschide panoul'],
    ['en', 'Open the dashboard'],
  ])(
    'names the garage and the job in the %s e-mail, with a button to the dashboard',
    (language, button) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toContain('Recondiționare injectoare');
      expect(mail.text).toContain('Service Auto Nord');
      expect(mail.text).toContain(button);
      expect(mail.text).toContain(dashboard);
    },
  );

  it.each(['ro', 'en'])(
    'names the job in the %s push and opens the dashboard',
    (language) => {
      const push = render(KIND, 'push', language, params);

      expect(push.body).toContain('Recondiționare injectoare');
      expect(push.link).toBe(dashboard);
    },
  );

  it.each(['ro', 'en'])(
    'keeps the %s push within its limits for the longest names',
    (language) => {
      const longest = {
        dashboard,
        garage: 'G'.repeat(80),
        job: 'J'.repeat(80),
      };

      expect(() => render(KIND, 'push', language, longest)).not.toThrow();
    },
  );
});
