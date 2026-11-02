import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const garageLink = 'https://motorfix.test/app/garage/requests';
const driverLink = 'https://motorfix.test/app/driver/requests/r-1';

// @traces 184-FR-005
// @traces 184-FR-014
describe('the garage’s notice of a move asked', () => {
  const KIND = 'BOOKING_MOVE_REQUESTED';
  const params = {
    app: 'https://motorfix.test',
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: garageLink,
    slot: '2026-10-16T06:00:00.000Z',
    to: '2026-10-19T06:00:00.000Z',
  };

  it('is registered for the garage and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('garage');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
    expect(NOTIFICATION_TYPES[KIND]).toMatchObject({
      channels: ['email', 'push', 'whatsapp'],
      trigger: 'event',
    });
  });

  it('names the driver, the car, the current and the asked time', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Andrei M. cere mutarea programării · Dacia Logan · de la 16 oct. 2026, 09:00 la 19 oct. 2026, 09:00',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Andrei M. asks to move the booking · Dacia Logan · from 16 Oct 2026, 09:00 to 19 Oct 2026, 09:00',
    );
    const push = render(KIND, 'push', 'ro', params);
    expect(push.title).toBe('Cerere de mutare a programării');
    expect(push.link).toBe(garageLink);
  });

  it('writes the e-mail with the car in the subject and both times in the body', () => {
    const ro = render(KIND, 'email', 'ro', params);
    const en = render(KIND, 'email', 'en', params);

    expect(ro.subject).toBe('Cerere de mutare: Dacia Logan');
    expect(en.subject).toBe('Move asked: Dacia Logan');
    for (const mail of [ro, en]) {
      expect(mail.text).toContain('Andrei M.');
      expect(mail.text).toContain('16');
      expect(mail.text).toContain('19');
      expect(mail.html).toContain(garageLink);
    }
  });
});

// @traces 184-FR-007
// @traces 184-FR-014
describe('the driver’s notice of a move that lapsed', () => {
  const KIND = 'BOOKING_MOVE_LAPSED';
  const params = {
    app: 'https://motorfix.test',
    garage: 'Atelier Dinamo',
    link: driverLink,
    slot: '2026-10-09T06:00:00.000Z',
  };

  it('is registered for the driver, passes the template check and is always sent', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
    expect(NOTIFICATION_TYPES[KIND]).toMatchObject({
      channels: ['email', 'push', 'whatsapp'],
      trigger: 'event',
    });
  });

  it('says the booking stays at its time, with U+2011 in service‑ul', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Service‑ul nu a confirmat mutarea. Programarea rămâne 9 oct. 2026, 09:00.',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'The garage did not confirm the move. The booking stays 9 Oct 2026, 09:00.',
    );
    const push = render(KIND, 'push', 'en', params);
    expect(push.link).toBe(driverLink);
  });

  it('writes the e-mail naming the garage', () => {
    const ro = render(KIND, 'email', 'ro', params);
    const en = render(KIND, 'email', 'en', params);

    expect(ro.subject).toBe('Mutarea nu a fost confirmată: Atelier Dinamo');
    expect(en.subject).toBe('Move not confirmed: Atelier Dinamo');
    for (const mail of [ro, en]) {
      expect(mail.text).toContain('09:00');
      expect(mail.html).toContain(driverLink);
    }
  });
});
