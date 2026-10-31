import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const KIND = 'REPAIR_UPDATED';
const GARAGE = 'REPAIR_UPDATED.garage';
const ADMIN = 'REPAIR_UPDATED.admin';
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
    expect(TEMPLATES[GARAGE]?.audience).toBe('driver');
    expect(checkTemplates({ [GARAGE]: TEMPLATES[GARAGE] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[GARAGE]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('takes only the garage, the car and the link', () => {
    expect(Object.keys(TEMPLATES[GARAGE]?.values ?? {}).sort()).toEqual([
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
      const mail = render(GARAGE, 'email', language, params);
      expect(mail.subject).toContain('Garaj Nordic');
      expect(mail.text).toContain(line);
      expect(mail.html).toContain(`href="${link}"`);
      expect(render(GARAGE, 'push', language, params)).toMatchObject({
        body: line,
        link,
        title,
      });
    },
  );

  it.each(LANGUAGES)(
    'names the garage and the car on WhatsApp in %s',
    (language) => {
      expect(render(GARAGE, 'whatsapp', language, params)).toEqual({
        name: `motorfix_repair_updated_${language}`,
        params: ['Garaj Nordic', 'VW Golf 2015'],
      });
    },
  );
});

// @traces 1267-FR-012
describe('the message that MotorFix corrected a repair', () => {
  const admin = { ...params, by: 'admin', garage: 'MotorFix' };

  it('is its own driver text beside the garage one, both passing the template check', () => {
    const texts = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) => name.startsWith(KIND)),
    );
    expect(Object.keys(texts).sort()).toEqual([ADMIN, GARAGE]);
    expect(texts[ADMIN].audience).toBe('driver');
    expect(checkTemplates(texts)).toEqual([]);
  });

  it('is picked when an admin made the correction, the garage text otherwise', () => {
    expect(templateName(KIND, { by: 'admin' })).toBe(ADMIN);
    expect(templateName(KIND, { by: 'owner' })).toBe(GARAGE);
    expect(templateName(KIND, {})).toBe(GARAGE);
  });

  it.each([
    [
      'ro',
      'MotorFix a corectat o reparație din istoricul VW Golf 2015.',
      'MotorFix a corectat o reparație a mașinii VW Golf 2015',
      'Istoricul arată reparația așa cum a corectat-o MotorFix.',
      'Primești acest e-mail pentru că o reparație din istoricul mașinii tale pe MotorFix a fost corectată.',
      'Istoric de reparații actualizat',
    ],
    [
      'en',
      "MotorFix corrected a repair in VW Golf 2015's history.",
      'MotorFix corrected a repair of your VW Golf 2015',
      'The history shows the repair as MotorFix corrected it.',
      'You get this e-mail because a repair in your car history on MotorFix was corrected.',
      'Repair history updated',
    ],
  ] as const)(
    'says in %s that MotorFix corrected a repair of which car',
    (language, line, subject, second, reason, title) => {
      expect(bellText(KIND, language, admin)).toBe(line);
      const mail = render(ADMIN, 'email', language, admin);
      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(line);
      expect(mail.text).toContain(second);
      expect(mail.text).toContain(reason);
      expect(mail.html).toContain(`href="${link}"`);
      expect(render(ADMIN, 'push', language, admin)).toMatchObject({
        body: line,
        link,
        title,
      });
    },
  );

  it.each(LANGUAGES)(
    'names MotorFix and the car on the registered WhatsApp template in %s',
    (language) => {
      expect(render(ADMIN, 'whatsapp', language, admin)).toEqual({
        name: `motorfix_repair_updated_${language}`,
        params: ['MotorFix', 'VW Golf 2015'],
      });
    },
  );
});
