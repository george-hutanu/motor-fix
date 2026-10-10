import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'ADMIN_GARAGE_REPORTED';
const dashboard = 'https://motorfix.test/app/admin';
const params = {
  brief: 'Mi-au cerut bani pentru o piesă pe care nu au montat-o.',
  dashboard,
  garage: 'Atelier Dinamo',
  text: 'Mi-au cerut bani pentru o piesă pe care nu au montat-o.',
};

// @traces 312-FR-013
describe('the garage report alert', () => {
  it('goes by e-mail and push only, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(['email', 'push']);
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it.each([
    ['ro', 'Deschide panoul'],
    ['en', 'Open the dashboard'],
  ])(
    'names the garage and quotes the report in %s, with a button to the dashboard',
    (language, button) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toContain('Atelier Dinamo');
      expect(mail.text).toContain('Atelier Dinamo');
      expect(mail.text).toContain(params.text);
      expect(mail.text).toContain(button);
      expect(mail.text).toContain(dashboard);
    },
  );

  it('shows a report with markup as plain text', () => {
    const mail = render(KIND, 'email', 'ro', {
      ...params,
      text: '<script>alert(1)</script> și încă ceva aici',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it.each(['ro', 'en'])(
    'sends a push in %s that opens the dashboard',
    (language) => {
      const push = render(KIND, 'push', language, params);

      expect(push.body).toContain(params.brief);
      expect(push.link).toBe(dashboard);
    },
  );

  it.each(['ro', 'en'])('names the garage in the bell in %s', (language) => {
    expect(render(KIND, 'bell', language, params)).toContain('Atelier Dinamo');
  });
});
