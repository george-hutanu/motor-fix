import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'ADMIN_RECHECK_DUE';
const dashboard = 'https://motorfix.test/app/admin/garages';

// @traces 1351-FR-009 1351-FR-015
describe('the daily alert for garages due a re-check', () => {
  it('goes to the bell, by e-mail and by push, can be muted, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(['email', 'push']);
    expect(NOTIFICATION_TYPES[KIND].alwaysSent).toBe(false);
    expect(TEMPLATES[KIND]).toBeDefined();
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('carries the link to the admin list and the count, nothing else', () => {
    expect(TEMPLATES[KIND]?.values).toEqual({
      dashboard: 'link',
      garages: 'text',
    });
  });

  it.each([
    ['ro', '12 service-uri', '12 service-uri de reverificat în registrul RAR'],
    ['ro', '1 service', '1 service de reverificat în registrul RAR'],
    ['en', '12 garages', '12 garages to re-check in the RAR register'],
    ['en', '1 garage', '1 garage to re-check in the RAR register'],
  ])(
    'reads in %s for %s in the e-mail, the bell and the push',
    (language, garages, line) => {
      const params = { dashboard, garages };

      const mail = render(KIND, 'email', language, params);
      expect(mail.subject).toBe(line);
      expect(mail.text).toContain(dashboard);
      expect(render(KIND, 'bell', language, params)).toBe(line);
      const push = render(KIND, 'push', language, params);
      expect(push.title).toBe(line);
      expect(push.link).toBe(dashboard);
    },
  );
});
