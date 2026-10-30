import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'REPAIR_UPDATED';
const LANGUAGES = ['ro', 'en'] as const;
const link = 'https://motorfix.test/app/driver?view=cars';
const params = { car: 'VW Golf 2015', garage: 'Garaj Nordic', link };

// @traces 409-FR-014
describe('the message that a garage corrected a repair', () => {
  it('goes to a driver by e-mail, push and WhatsApp, muted by reviews and history, and passes the template check', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
    expect(NOTIFICATION_TYPES[KIND].group).toBe('reviews_history');
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
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

  it('takes only the garage, the car and the link', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'car',
      'garage',
      'link',
    ]);
  });

  it.each([
    [
      'ro',
      'Garaj Nordic a corectat o reparație din istoricul VW Golf 2015.',
      'Istoric de reparații actualizat',
    ],
    [
      'en',
      "Garaj Nordic corrected a repair in VW Golf 2015's history.",
      'Repair history updated',
    ],
  ] as const)(
    'says in %s which garage corrected a repair of which car',
    (language, line, title) => {
      expect(bellText(KIND, language, params)).toBe(line);
      const mail = render(KIND, 'email', language, params);
      expect(mail.subject).toContain('Garaj Nordic');
      expect(mail.text).toContain(line);
      expect(mail.html).toContain(`href="${link}"`);
      expect(render(KIND, 'push', language, params)).toMatchObject({
        body: line,
        link,
        title,
      });
    },
  );

  it.each(LANGUAGES)(
    'names the garage and the car on WhatsApp in %s',
    (language) => {
      expect(render(KIND, 'whatsapp', language, params)).toEqual({
        name: `motorfix_repair_updated_${language}`,
        params: ['Garaj Nordic', 'VW Golf 2015'],
      });
    },
  );
});
