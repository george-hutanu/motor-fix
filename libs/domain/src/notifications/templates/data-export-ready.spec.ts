// @traces 140-FR-006
import { TEMPLATES } from './registry';
import { notificationType } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const params = { link: 'https://motorfix.test/ro/app/driver/settings' };

describe('the data file ready e-mail', () => {
  it('is the template the notification type picks', () => {
    expect(templateName('DATA_EXPORT_READY', params)).toBe('DATA_EXPORT_READY');
  });

  it('passes the template check', () => {
    const template = TEMPLATES['DATA_EXPORT_READY'];

    expect(template).toBeDefined();
    expect(checkTemplates({ DATA_EXPORT_READY: template })).toEqual([]);
  });

  it('says the file is ready, in Romanian, with a button to Setări', () => {
    const mail = render('DATA_EXPORT_READY', 'email', 'ro', params);

    expect(mail.subject).toBe('Fișierul tău cu date e gata');
    expect(mail.html).toContain(params.link);
    expect(mail.text).toContain(params.link);
  });

  it('says the file is ready, in English', () => {
    const mail = render('DATA_EXPORT_READY', 'email', 'en', {
      link: 'https://motorfix.test/en/app/driver/settings',
    });

    expect(mail.subject).toBe('Your data file is ready');
    expect(mail.html).toContain('https://motorfix.test/en/app/driver/settings');
  });

  it('goes straight to the account, by e-mail only, and cannot be muted', () => {
    const type = notificationType('DATA_EXPORT_READY');

    expect(type.trigger).toBe('direct');
    expect(type.channels).toEqual(['email']);
    expect(type.transactional).toBe(true);
  });
});
