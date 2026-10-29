import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render } from '../templates';

const KIND = 'CAR_TRANSFER_ACCEPTED';
const LANGUAGES = ['ro', 'en'] as const;
const link = 'https://motorfix.test/app/driver?view=cars';
const params = { car: 'VW Golf', link };

// @traces 1265-FR-009
describe('the message that a sold car was taken over', () => {
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

  it('takes only the car and the link: never the buyer', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'car',
      'link',
    ]);
  });

  it.each([
    [
      'ro',
      'Mașina VW Golf a fost preluată de cumpărător. Istoricul ei rămâne la tine, doar pentru citire, până la data vânzării.',
      'VW Golf a fost preluată',
      'Mașină preluată',
    ],
    [
      'en',
      'The buyer has taken over your VW Golf. Its history stays with you, read-only, up to the sale date.',
      'Your VW Golf has been taken over',
      'Car taken over',
    ],
  ] as const)(
    'says in %s the car was taken over and its history stays read-only',
    (language, line, subject, title) => {
      expect(bellText(KIND, language, params)).toBe(line);
      const mail = render(KIND, 'email', language, params);
      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(line);
      expect(mail.html).toContain(`href="${link}"`);
      expect(render(KIND, 'push', language, params)).toMatchObject({
        body: line,
        link,
        title,
      });
    },
  );

  it.each(LANGUAGES)('names the car on WhatsApp in %s', (language) => {
    expect(render(KIND, 'whatsapp', language, params)).toEqual({
      name: `motorfix_car_transfer_accepted_${language}`,
      params: ['VW Golf'],
    });
  });

  it.each([
    ['ro', 'Vezi mașinile vândute'],
    ['en', 'See sold cars'],
  ] as const)('opens the sold cars from the e-mail button in %s', (language, label) => {
    expect(render(KIND, 'email', language, params).text).toContain(label);
  });
});
