import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const app = 'https://motorfix.test';
const link = `${app}/app/garage/requests`;

// Friday 09:00 in Bucharest.
const slot = '2026-10-30T07:00:00.000Z';

const params = (over: Record<string, unknown> = {}) => ({
  app,
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  link,
  note: '',
  reason: 'plans_changed',
  slot,
  variant: 'driver',
  ...over,
});

// @traces 1258-driver-cancel-FR-006
describe('the driver’s booking cancellation message', () => {
  it('has a text in time and a late one, both for the garage and passing the template check', () => {
    const cancelled = Object.fromEntries(
      Object.entries(TEMPLATES).filter(([name]) =>
        name.startsWith('BOOKING_CANCELLED'),
      ),
    );

    expect(Object.keys(cancelled).sort()).toEqual([
      'BOOKING_CANCELLED.driver',
      'BOOKING_CANCELLED.driver_late',
    ]);
    for (const template of Object.values(cancelled)) {
      expect(template.audience).toBe('garage');
    }
    expect(checkTemplates(cancelled)).toEqual([]);
  });

  it('picks the text by its variant, and keeps the closed account’s as it was', () => {
    expect(templateName('BOOKING_CANCELLED', { variant: 'driver' })).toBe(
      'BOOKING_CANCELLED.driver',
    );
    expect(templateName('BOOKING_CANCELLED', { variant: 'driver_late' })).toBe(
      'BOOKING_CANCELLED.driver_late',
    );
    expect(
      templateName('BOOKING_CANCELLED', { reason: 'driver_account_closed' }),
    ).toBe('BOOKING_CANCELLED');
    expect(
      bellText('BOOKING_CANCELLED', 'ro', {
        reason: 'driver_account_closed',
      }),
    ).toBe(bellText('GENERIC', 'ro', {}));
  });

  it('names the driver, the car and the slot in the bell and the push, in both languages', () => {
    const bellRo = render('BOOKING_CANCELLED.driver', 'bell', 'ro', params());
    const bellEn = render('BOOKING_CANCELLED.driver', 'bell', 'en', params());

    expect(bellRo).toMatch(/^Andrei M\. a anulat programarea · Dacia Logan · /);
    expect(bellEn).toMatch(
      /^Andrei M\. cancelled the booking · Dacia Logan · /,
    );
    expect(bellRo).toContain('09:00');
    const push = render('BOOKING_CANCELLED.driver', 'push', 'ro', params());
    expect(push.body).toMatch(/^Andrei M\. a anulat programarea · Dacia Logan/);
    expect(push.link).toBe(link);
  });

  it('writes the e-mail with the reason’s label and the note, in Romanian', () => {
    const mail = render(
      'BOOKING_CANCELLED.driver',
      'email',
      'ro',
      params({ note: 'Am găsit un loc mai aproape' }),
    );

    expect(mail.subject).toMatch(/^Programare anulată: Dacia Logan, /);
    expect(mail.text).toContain('Andrei M.');
    expect(mail.text).toContain('Mi s-au schimbat planurile');
    expect(mail.text).toContain('Am găsit un loc mai aproape');
    expect(mail.text).toContain(link);
    expect(mail.text).not.toContain('Anulare târzie');
  });

  it('writes the e-mail in English, with each reason’s own label', () => {
    const labels = {
      found_another_garage: 'Found another garage',
      other: 'Other',
      plans_changed: 'Plans changed',
      problem_solved: 'Problem solved',
    };
    for (const [reason, label] of Object.entries(labels)) {
      const mail = render(
        'BOOKING_CANCELLED.driver',
        'email',
        'en',
        params({ reason }),
      );
      expect(mail.subject).toMatch(/^Booking cancelled: Dacia Logan, /);
      expect(mail.text).toContain(label);
    }
  });

  it('leaves the note’s line out when there is no note', () => {
    const without = render('BOOKING_CANCELLED.driver', 'email', 'ro', params());
    const withNote = render(
      'BOOKING_CANCELLED.driver',
      'email',
      'ro',
      params({ note: 'Nota' }),
    );

    expect(withNote.text.split('\n\n')).toHaveLength(
      without.text.split('\n\n').length + 1,
    );
    expect(without.text).not.toMatch(/\n\n\n/);
  });

  it('adds the late line, with no penalty, to the late text', () => {
    const ro = render(
      'BOOKING_CANCELLED.driver_late',
      'email',
      'ro',
      params({ variant: 'driver_late' }),
    );
    const en = render(
      'BOOKING_CANCELLED.driver_late',
      'email',
      'en',
      params({ variant: 'driver_late' }),
    );

    expect(ro.text).toContain(
      'Anulare târzie (sub 2 ore înainte), fără penalizare.',
    );
    expect(en.text).toContain(
      'Late cancellation (under 2 hours before), no penalty.',
    );
  });

  it('escapes the note as text, never markup, and keeps it out of the push', () => {
    const note = '<b>vin</b> & <script>x</script>';
    const mail = render(
      'BOOKING_CANCELLED.driver',
      'email',
      'en',
      params({ note }),
    );
    const push = render(
      'BOOKING_CANCELLED.driver',
      'push',
      'en',
      params({ note }),
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;b&gt;vin&lt;/b&gt;');
    expect(JSON.stringify(push)).not.toContain('vin');
  });
});
