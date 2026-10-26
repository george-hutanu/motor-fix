import { TEMPLATES } from './registry';
import { render } from '../templates';

const app = 'https://motorfix.test';
const link = `${app}/app/driver/requests/0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d`;
const PUSH_MAX = 120;

const cases = [
  ['REQUEST_REMINDER', { app, car: 'X', driver: 'Andrei M.', link }],
  ['REQUEST_EXPIRED.garage', { app, car: 'X', driver: 'Andrei M.', link }],
  ['REQUEST_EXPIRED.driver', { app, car: 'X', link }],
  ['QUOTE_EXPIRED.garage', { app, car: 'X', driver: 'Andrei M.', link }],
  ['QUOTE_EXPIRED.driver', { app, car: 'X', garage: 'Auto Ș', link }],
] as const;

const withCar = (params: object, car: string) => ({ ...params, car });

// @traces 1257-FR-009
describe('the reminder and expiry texts for odd cars and names', () => {
  it.each(cases)(
    '%s keeps markup in the car name out of the e-mail html',
    (name, params) => {
      const p = withCar(params, '<script>x()</script>');
      for (const language of ['ro', 'en']) {
        const mail = render(name, 'email', language, p);
        expect(mail.html).not.toContain('<script');
      }
    },
  );

  it.each(cases)(
    '%s keeps the push title and body within 120 characters for a car of 300 characters',
    (name, params) => {
      for (const language of ['ro', 'en']) {
        const push = render(
          name,
          'push',
          language,
          withCar(params, 'Ș'.repeat(300)),
        );
        expect([...push.body].length).toBeLessThanOrEqual(PUSH_MAX);
        expect([...push.title].length).toBeLessThanOrEqual(PUSH_MAX);
      }
    },
  );

  it.each(cases)(
    '%s keeps the push body within 120 UTF-16 units for 100 emoji',
    (name, params) => {
      const push = render(
        name,
        'push',
        'en',
        withCar(params, '\u{1F600}'.repeat(100)),
      );
      expect(push.body.length).toBeLessThanOrEqual(PUSH_MAX);
    },
  );

  it.each(cases)(
    '%s refuses a null car rather than print "null" or "undefined"',
    (name, params) => {
      expect(() =>
        render(name, 'bell', 'en', withCar(params, null as never)),
      ).toThrow(/missing value car/);
    },
  );

  it.each(cases)(
    '%s renders an unknown language in Romanian',
    (name, params) => {
      expect(render(name, 'bell', 'fr', params)).toBe(
        render(name, 'bell', 'ro', params),
      );
    },
  );

  it.each(cases)(
    '%s prints no "undefined" or "null" in any text',
    (name, params) => {
      for (const language of ['ro', 'en']) {
        const texts = [
          render(name, 'bell', language, params),
          JSON.stringify(render(name, 'push', language, params)),
          JSON.stringify(render(name, 'email', language, params)),
          JSON.stringify(render(name, 'whatsapp', language, params)),
        ].join('\n');
        expect(texts).not.toMatch(/undefined|null|\[object/);
      }
    },
  );

  it('registers no template carrying a phone, plate or description value', () => {
    for (const [name] of cases) {
      const keys = Object.keys(TEMPLATES[name]?.values ?? {});
      expect(
        keys.filter((k) => /phone|plate|description|email/i.test(k)),
      ).toEqual([]);
    }
  });
});
