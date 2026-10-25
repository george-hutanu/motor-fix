import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const app = 'https://motorfix.test';
const REQUEST = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';

// @traces 1257-FR-008 1257-FR-009
describe('the expired quote messages', () => {
  it('has one text for the driver and one for the garage, both passing the template check', () => {
    const expired = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) =>
        name.startsWith('QUOTE_EXPIRED'),
      ),
    );

    expect(Object.keys(expired).sort()).toEqual([
      'QUOTE_EXPIRED.driver',
      'QUOTE_EXPIRED.garage',
    ]);
    expect(expired['QUOTE_EXPIRED.driver'].audience).toBe('driver');
    expect(expired['QUOTE_EXPIRED.garage'].audience).toBe('garage');
    expect(checkTemplates(expired)).toEqual([]);
  });

  it('picks the text by the side the message goes to', () => {
    expect(templateName('QUOTE_EXPIRED', { side: 'garage' })).toBe(
      'QUOTE_EXPIRED.garage',
    );
    expect(templateName('QUOTE_EXPIRED', { side: 'driver' })).toBe(
      'QUOTE_EXPIRED.driver',
    );
  });

  it.each(['email', 'push', 'whatsapp', 'bell'] as const)(
    'has %s texts in both languages for each side',
    (channel) => {
      for (const side of ['driver', 'garage']) {
        expect(
          Object.keys(TEMPLATES[`QUOTE_EXPIRED.${side}`]?.[channel] ?? {}),
        ).toEqual(expect.arrayContaining(['en', 'ro']));
      }
    },
  );

  it('tells the driver whose quote for which car expired, opening the request', () => {
    const link = `${app}/app/driver/requests/${REQUEST}`;
    const params = {
      app,
      car: 'Mini Cooper S',
      garage: 'Atelier Dinamo',
      link,
    };

    expect(render('QUOTE_EXPIRED.driver', 'bell', 'ro', params)).toBe(
      'Oferta de la Atelier Dinamo pentru Mini Cooper S a expirat',
    );
    expect(render('QUOTE_EXPIRED.driver', 'bell', 'en', params)).toBe(
      'The quote from Atelier Dinamo for the Mini Cooper S expired',
    );
    for (const language of ['ro', 'en']) {
      const mail = render('QUOTE_EXPIRED.driver', 'email', language, params);
      expect(mail.subject).toContain('Mini Cooper S');
      expect(mail.text).toContain('Atelier Dinamo');
      expect(mail.text).toContain(link);
    }
    expect(render('QUOTE_EXPIRED.driver', 'push', 'en', params).link).toBe(
      link,
    );
    expect(render('QUOTE_EXPIRED.driver', 'whatsapp', 'en', params)).toEqual({
      name: 'motorfix_quote_expired_driver_en',
      params: ['Atelier Dinamo', 'Mini Cooper S'],
    });
  });

  it('tells the garage which driver’s quote expired, opening the requests', () => {
    const link = `${app}/app/garage/requests`;
    const params = { app, car: 'Dacia Logan', driver: 'Andrei M.', link };

    expect(render('QUOTE_EXPIRED.garage', 'bell', 'ro', params)).toBe(
      'Oferta trimisă lui Andrei M. a expirat: Dacia Logan',
    );
    expect(render('QUOTE_EXPIRED.garage', 'bell', 'en', params)).toBe(
      'Your quote to Andrei M. expired: Dacia Logan',
    );
    expect(
      render('QUOTE_EXPIRED.garage', 'email', 'ro', params).text,
    ).toContain(link);
    expect(render('QUOTE_EXPIRED.garage', 'whatsapp', 'ro', params)).toEqual({
      name: 'motorfix_quote_expired_garage_ro',
      params: ['Andrei M.', 'Dacia Logan'],
    });
  });

  it('takes no plate, phone or description', () => {
    expect(
      Object.keys(TEMPLATES['QUOTE_EXPIRED.driver']?.values ?? {}).sort(),
    ).toEqual(['car', 'garage', 'link']);
    expect(
      Object.keys(TEMPLATES['QUOTE_EXPIRED.garage']?.values ?? {}).sort(),
    ).toEqual(['car', 'driver', 'link']);
  });
});
