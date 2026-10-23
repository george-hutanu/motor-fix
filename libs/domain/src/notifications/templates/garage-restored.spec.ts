import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'GARAGE_RESTORED';
const LANGUAGES = ['ro', 'en'] as const;
const link = 'https://motorfix.test/app/garage';
const params = { garage: 'Atelier Dinamo', link };

// @traces 067-FR-008
describe('the message that a garage is back on the map', () => {
  it('is always sent by e-mail, push and WhatsApp and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
    expect(TEMPLATES[KIND]?.audience).toBe('garage');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('takes only the garage and the link: no cause, no note, nothing personal', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'garage',
      'link',
    ]);
  });

  it('says in Romanian the profile is back on the map', () => {
    const mail = render(KIND, 'email', 'ro', params);

    expect(mail.subject).toBe('Atelier Dinamo: profilul este din nou pe hartă');
    expect(mail.text).toContain('Profilul tău este din nou pe hartă.');
    expect(mail.text).toContain('Clienții te pot găsi și rezerva din nou.');
    expect(mail.text).toContain(link);
  });

  it('says the same in English', () => {
    const mail = render(KIND, 'email', 'en', params);

    expect(mail.subject).toBe(
      'Atelier Dinamo: your profile is back on the map',
    );
    expect(mail.text).toContain('Your profile is back on the map.');
    expect(mail.text).toContain('Drivers can find and book you again.');
  });

  it.each([
    ['ro', 'Profilul tău este din nou pe hartă.'],
    ['en', 'Your profile is back on the map.'],
  ] as const)(
    'puts the same line in the bell and the push in %s',
    (language, line) => {
      expect(bellText(KIND, language, params)).toContain(line);
      expect(render(KIND, 'push', language, params)).toMatchObject({
        body: line,
        link,
      });
    },
  );

  it.each(LANGUAGES)(
    'opens the garage dashboard from the e-mail button and names the garage on WhatsApp in %s',
    (language) => {
      expect(render(KIND, 'email', language, params).html).toContain(
        `href="${link}"`,
      );
      expect(render(KIND, 'whatsapp', language, params)).toEqual({
        name: `motorfix_garage_restored_${language}`,
        params: ['Atelier Dinamo', link],
      });
    },
  );

  it('shows a garage name with markup as plain text', () => {
    const mail = render(KIND, 'email', 'ro', {
      ...params,
      garage: '<b>Atelier</b>',
    });

    expect(mail.html).not.toContain('<b>Atelier</b>');
    expect(mail.html).toContain('&lt;b&gt;Atelier&lt;/b&gt;');
  });
});
