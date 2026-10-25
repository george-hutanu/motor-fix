import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const app = 'https://motorfix.test';
const REQUEST = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';

// @traces 1257-FR-005 1257-FR-009
describe('the expired request messages', () => {
  it('has one text for the driver and one for the garage, both passing the template check', () => {
    const expired = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) =>
        name.startsWith('REQUEST_EXPIRED'),
      ),
    );

    expect(Object.keys(expired).sort()).toEqual([
      'REQUEST_EXPIRED.driver',
      'REQUEST_EXPIRED.garage',
    ]);
    expect(expired['REQUEST_EXPIRED.driver'].audience).toBe('driver');
    expect(expired['REQUEST_EXPIRED.garage'].audience).toBe('garage');
    expect(checkTemplates(expired)).toEqual([]);
  });

  it('picks the text by the side the message goes to', () => {
    expect(templateName('REQUEST_EXPIRED', { side: 'garage' })).toBe(
      'REQUEST_EXPIRED.garage',
    );
    expect(templateName('REQUEST_EXPIRED', { side: 'driver' })).toBe(
      'REQUEST_EXPIRED.driver',
    );
  });

  it.each(['email', 'push', 'whatsapp', 'bell'] as const)(
    'has %s texts in both languages for each side',
    (channel) => {
      for (const side of ['driver', 'garage']) {
        expect(
          Object.keys(TEMPLATES[`REQUEST_EXPIRED.${side}`]?.[channel] ?? {}),
        ).toEqual(expect.arrayContaining(['en', 'ro']));
      }
    },
  );

  describe('to the driver', () => {
    const link = `${app}/app/driver/requests/${REQUEST}`;
    const params = { app, car: 'Mini Cooper S', link };

    it('names the car and asks other garages, in both languages', () => {
      expect(render('REQUEST_EXPIRED.driver', 'bell', 'ro', params)).toBe(
        'Cererea pentru Mini Cooper S a expirat. Cere oferte de la alte service-uri.',
      );
      expect(render('REQUEST_EXPIRED.driver', 'bell', 'en', params)).toBe(
        'Your request for the Mini Cooper S expired. Ask other garages for quotes.',
      );
    });

    it.each([
      ['ro', 'Cere oferte de la alte service-uri'],
      ['en', 'Ask other garages for quotes'],
    ])(
      'sends an e-mail in %s whose button "%s" opens the request',
      (language, label) => {
        const mail = render(
          'REQUEST_EXPIRED.driver',
          'email',
          language,
          params,
        );

        expect(mail.subject).toContain('Mini Cooper S');
        expect(mail.text).toContain(label);
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(link);
      },
    );

    it('opens the request from the push and names the car on WhatsApp', () => {
      expect(render('REQUEST_EXPIRED.driver', 'push', 'en', params).link).toBe(
        link,
      );
      expect(
        render('REQUEST_EXPIRED.driver', 'whatsapp', 'ro', params),
      ).toEqual({
        name: 'motorfix_request_expired_driver_ro',
        params: ['Mini Cooper S'],
      });
    });

    it('takes the car and the link only', () => {
      expect(
        Object.keys(TEMPLATES['REQUEST_EXPIRED.driver']?.values ?? {}).sort(),
      ).toEqual(['car', 'link']);
    });
  });

  describe('to the garage', () => {
    const link = `${app}/app/garage/requests`;
    const params = { app, car: 'Dacia Logan', driver: 'Andrei M.', link };

    it('names the driver and the car, in both languages', () => {
      expect(render('REQUEST_EXPIRED.garage', 'bell', 'ro', params)).toBe(
        'Cererea lui Andrei M. a expirat: Dacia Logan',
      );
      expect(render('REQUEST_EXPIRED.garage', 'bell', 'en', params)).toBe(
        'Andrei M.’s request expired: Dacia Logan',
      );
      expect(
        render('REQUEST_EXPIRED.garage', 'email', 'ro', params).text,
      ).toContain(link);
      expect(
        render('REQUEST_EXPIRED.garage', 'whatsapp', 'en', params),
      ).toEqual({
        name: 'motorfix_request_expired_garage_en',
        params: ['Andrei M.', 'Dacia Logan'],
      });
    });

    it('takes no plate, phone or description', () => {
      expect(
        Object.keys(TEMPLATES['REQUEST_EXPIRED.garage']?.values ?? {}).sort(),
      ).toEqual(['car', 'driver', 'link']);
    });
  });
});
