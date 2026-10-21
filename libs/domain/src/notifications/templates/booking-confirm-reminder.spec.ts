import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'BOOKING_CONFIRM_REMINDER';
const link = 'https://motorfix.test/app/garage/requests';
const params = {
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  left: 12,
  link,
  slot: '2026-10-16T06:00:00.000Z',
  until: '2026-10-15T15:00:00.000Z',
};

// @traces 389-FR-011
describe('the reminder to confirm a booking', () => {
  it('is registered for the garage, passes the template check and stays a timer sent always', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('garage');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
    expect(NOTIFICATION_TYPES[KIND]).toMatchObject({
      channels: ['email', 'push', 'whatsapp'],
      trigger: 'timer',
    });
  });

  it('names the driver, the car, the slot and the hours left in the bell and the push', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Confirmă programarea lui Andrei M. · Dacia Logan · 16 oct. 2026, 09:00 · mai ai 12 h',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Confirm Andrei M.’s booking · Dacia Logan · 16 Oct 2026, 09:00 · 12 h left',
    );
    const push = render(KIND, 'push', 'ro', { ...params, left: 2 });
    expect(push.title).toBe('Confirmă programarea');
    expect(push.body).toBe(
      'Andrei M. · Dacia Logan · 16 oct. 2026, 09:00 · mai ai 2 h',
    );
    expect(push.link).toBe(link);
  });

  it('writes the e-mail with the car in the subject and when the booking lapses in the body', () => {
    const ro = render(KIND, 'email', 'ro', params);
    const en = render(KIND, 'email', 'en', params);

    expect(ro.subject).toBe('Confirmă programarea: Dacia Logan');
    expect(en.subject).toBe('Confirm the booking: Dacia Logan');
    for (const mail of [ro, en]) {
      expect(mail.text).toContain('Andrei M.');
      expect(mail.text).toContain('09:00');
      expect(mail.text).toContain('18:00');
      expect(mail.html).toContain(link);
    }
  });
});
