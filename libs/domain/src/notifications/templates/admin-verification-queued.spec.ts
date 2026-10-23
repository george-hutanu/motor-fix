import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'ADMIN_VERIFICATION_QUEUED';
const dashboard = 'https://motorfix.test/app/admin';
const params = { dashboard, garage: 'Auto Vest Motors' };

// @traces 301-FR-010
describe('the alert for a file waiting for verification', () => {
  it('goes to the bell, by e-mail and by push, can be muted, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(['email', 'push']);
    expect(NOTIFICATION_TYPES[KIND].alwaysSent).toBe(false);
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it.each([
    ['ro', 'a trimis dosarul de verificare', 'Deschide panoul'],
    ['en', 'sent its verification file', 'Open the dashboard'],
  ])(
    'names the garage in %s, with a button to the dashboard',
    (language, line, button) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toBe(`Auto Vest Motors ${line}`);
      expect(mail.text).toContain(button);
      expect(mail.text).toContain(dashboard);
    },
  );

  it.each([
    ['ro', 'Auto Vest Motors a trimis dosarul de verificare'],
    ['en', 'Auto Vest Motors sent its verification file'],
  ])('reads in the bell and the push in %s', (language, line) => {
    expect(render(KIND, 'bell', language, params)).toBe(line);
    const push = render(KIND, 'push', language, params);
    expect(push.title).toBe(line);
    expect(push.link).toBe(dashboard);
  });
});

// @traces 068-FR-011
describe('the alert for yearly documents waiting for an admin', () => {
  const yearly = { ...params, item: 'documents' };
  const name = templateName(KIND, yearly);

  it('is a text of its own of the same type, passing the template check', () => {
    expect(name).toBe(`${KIND}.documents`);
    expect(templateName(KIND, params)).toBe(KIND);
    expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
  });

  it.each([
    [
      'ro',
      'Documente anuale de verificat: Auto Vest Motors',
      'Deschide panoul',
    ],
    ['en', 'Yearly documents to check: Auto Vest Motors', 'Open the dashboard'],
  ])(
    'names the garage and the yearly documents in %s',
    (language, line, button) => {
      expect(render(name, 'bell', language, yearly)).toBe(line);
      const mail = render(name, 'email', language, yearly);
      expect(mail.subject).toBe(line);
      expect(mail.text).toContain(button);
      expect(mail.text).toContain(dashboard);
      expect(render(name, 'push', language, yearly).link).toBe(dashboard);
    },
  );
});
