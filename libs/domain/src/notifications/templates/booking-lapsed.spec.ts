import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const app = 'https://motorfix.test';

// @traces 389-FR-013
describe('the lapsed booking messages', () => {
  it('has one text for the driver and one for the garage, both passing the template check', () => {
    const lapsed = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) =>
        name.startsWith('BOOKING_LAPSED'),
      ),
    );

    expect(Object.keys(lapsed).sort()).toEqual([
      'BOOKING_LAPSED.driver',
      'BOOKING_LAPSED.garage',
    ]);
    expect(lapsed['BOOKING_LAPSED.driver'].audience).toBe('driver');
    expect(lapsed['BOOKING_LAPSED.garage'].audience).toBe('garage');
    expect(checkTemplates(lapsed)).toEqual([]);
  });

  it('picks the text by the side the message goes to', () => {
    expect(templateName('BOOKING_LAPSED', { side: 'garage' })).toBe(
      'BOOKING_LAPSED.garage',
    );
    expect(templateName('BOOKING_LAPSED', { side: 'driver' })).toBe(
      'BOOKING_LAPSED.driver',
    );
  });

  it('tells the driver to choose another quote, opening Cererile mele', () => {
    const params = {
      app,
      garage: 'Atelier Dinamo',
      link: `${app}/app/driver/requests/r-1`,
    };

    expect(render('BOOKING_LAPSED.driver', 'bell', 'ro', params)).toBe(
      'Service‑ul nu a confirmat. Alege altă ofertă.',
    );
    expect(render('BOOKING_LAPSED.driver', 'bell', 'en', params)).toBe(
      'The garage did not confirm. Choose another quote.',
    );
    expect(render('BOOKING_LAPSED.driver', 'email', 'ro', params).subject).toBe(
      'Programarea nu a fost confirmată',
    );
    expect(render('BOOKING_LAPSED.driver', 'email', 'en', params).subject).toBe(
      'The booking was not confirmed',
    );
    expect(render('BOOKING_LAPSED.driver', 'push', 'en', params).link).toBe(
      `${app}/app/driver/requests/r-1`,
    );
  });

  it('tells the garage whose booking lapsed, opening Oferte trimise', () => {
    const params = {
      app,
      car: 'Dacia Logan',
      driver: 'Andrei M.',
      link: `${app}/app/garage/requests`,
    };

    expect(render('BOOKING_LAPSED.garage', 'bell', 'ro', params)).toBe(
      'Programarea lui Andrei M. a expirat neconfirmată',
    );
    expect(render('BOOKING_LAPSED.garage', 'bell', 'en', params)).toBe(
      'Andrei M.’s booking lapsed unconfirmed',
    );
    expect(render('BOOKING_LAPSED.garage', 'email', 'ro', params).subject).toBe(
      'Programare expirată: Dacia Logan',
    );
    expect(render('BOOKING_LAPSED.garage', 'push', 'ro', params).link).toBe(
      `${app}/app/garage/requests`,
    );
  });
});
