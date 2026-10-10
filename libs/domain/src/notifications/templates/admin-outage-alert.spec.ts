import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'ADMIN_OUTAGE_ALERT';
const at = '2026-10-10T03:04:05.000Z';
const dashboard = 'https://motorfix.test/app/admin';

// @traces 251-monitoring-backups-FR-008
describe('the outage alert', () => {
  it('goes by e-mail and push, and both texts pass the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(['email', 'push']);
    expect(
      checkTemplates({
        [`${KIND}.back`]: TEMPLATES[`${KIND}.back`],
        [`${KIND}.down`]: TEMPLATES[`${KIND}.down`],
      }),
    ).toEqual([]);
  });

  it('picks the text by the state of the check', () => {
    expect(templateName(KIND, { state: 'down' })).toBe(`${KIND}.down`);
    expect(templateName(KIND, { state: 'back' })).toBe(`${KIND}.back`);
  });

  it.each([
    ['en', 'down', 'is down'],
    ['ro', 'down', 'nu răspunde'],
    ['en', 'back', 'is back'],
    ['ro', 'back', 'a revenit'],
  ])(
    'names the service, the state and the time in an e-mail in %s when it is %s',
    (language, state, words) => {
      const mail = render(templateName(KIND, { state }), 'email', language, {
        at,
        dashboard,
        service: 'api',
        state,
      });

      expect(mail.subject).toContain('api');
      expect(mail.subject).toContain(words);
      expect(mail.text).toContain('api');
      expect(mail.text).toMatch(/\d{2}:\d{2}/);
      expect(mail.text).toContain(dashboard);
    },
  );

  it.each([
    ['en', 'down'],
    ['ro', 'down'],
    ['en', 'back'],
    ['ro', 'back'],
  ])(
    'sends a push in %s when it is %s that names the service',
    (language, state) => {
      const push = render(templateName(KIND, { state }), 'push', language, {
        at,
        dashboard,
        service: 'web',
        state,
      });

      expect(push.title).toContain('web');
      expect(push.body).toMatch(/\d{2}:\d{2}/);
      expect(push.link).toBe(dashboard);
    },
  );
});
