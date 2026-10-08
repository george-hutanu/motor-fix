import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'ADMIN_RULE_APPROVAL_NEEDED';
const settings = 'https://motorfix.test/app/admin/settings';
const params = {
  app: 'https://motorfix.test',
  brief: 'Ioana: Testăm recenziile din profil.',
  name: 'Ioana',
  reason: 'Testăm recenziile din profil.',
  settings,
};

describe('the rule approval alert', () => {
  it('goes by e-mail and push only, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual(['email', 'push']);
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('names the asker, the rule and the reason in Romanian, with Setări as the button', () => {
    const mail = render(KIND, 'email', 'ro', params);

    expect(mail.subject).toContain('Ioana');
    expect(mail.text).toContain('Recenzii doar după o lucrare confirmată');
    expect(mail.text).toContain('Testăm recenziile din profil.');
    expect(mail.text).toContain(settings);
  });

  it('names the asker, the rule and the reason in English', () => {
    const mail = render(KIND, 'email', 'en', params);

    expect(mail.subject).toContain('Ioana');
    expect(mail.text).toContain('Reviews only after a confirmed job');
    expect(mail.text).toContain('Testăm recenziile din profil.');
  });

  it('shows a reason with markup as plain text', () => {
    const mail = render(KIND, 'email', 'en', {
      ...params,
      reason: '<script>alert(1)</script>',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it.each(['ro', 'en'])('sends a push in %s that opens Setări', (language) => {
    const push = render(KIND, 'push', language, params);

    expect(push.body).toContain('Ioana: Testăm recenziile din profil.');
    expect(push.link).toBe(settings);
  });
});
