import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'BOOKING_CONFIRMED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
// 09:00 in Bucharest.
const params = {
  app: 'https://motorfix.test',
  garage: 'Atelier Dinamo',
  link,
  slot: '2026-10-16T06:00:00.000Z',
};

// @traces 389-FR-013
describe('the confirmed booking message to the driver', () => {
  it('is registered for the driver and passes the template check', () => {
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

  it('names the garage and the slot in Bucharest time in the bell and the push, opening Cererile mele', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Programare confirmată · Atelier Dinamo · 16 oct. 2026, 09:00',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Booking confirmed · Atelier Dinamo · 16 Oct 2026, 09:00',
    );
    const push = render(KIND, 'push', 'ro', params);
    expect(push.title).toBe('Programare confirmată');
    expect(push.body).toBe('Atelier Dinamo · 16 oct. 2026, 09:00');
    expect(push.link).toBe(link);
    expect(render(KIND, 'push', 'en', params).title).toBe('Booking confirmed');
  });

  it('puts the garage and the slot in the e-mail subject', () => {
    expect(render(KIND, 'email', 'ro', params).subject).toBe(
      'Programare confirmată: Atelier Dinamo, 16 oct. 2026, 09:00',
    );
    const en = render(KIND, 'email', 'en', params);
    expect(en.subject).toBe(
      'Booking confirmed: Atelier Dinamo, 16 Oct 2026, 09:00',
    );
    expect(en.html).toContain(link);
  });
});
