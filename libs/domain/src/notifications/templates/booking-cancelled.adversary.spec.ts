import { TEMPLATES } from './registry';
import { render, TemplateError } from '../templates';

// @traces 1258-driver-cancel-FR-006

const app = 'https://motorfix.test';
const link = `${app}/app/garage/requests`;
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

const NAMES = ['BOOKING_CANCELLED.driver', 'BOOKING_CANCELLED.driver_late'];

describe('the driver’s booking cancellation under hostile values', () => {
  it.each(NAMES)(
    '%s puts the note in the bell, keeps it out of the push, in both languages',
    (name) => {
      const note = 'SECRET-NOTE-123';
      for (const lang of ['ro', 'en']) {
        expect(render(name, 'bell', lang, params({ note }))).toContain(note);
        expect(
          JSON.stringify(render(name, 'push', lang, params({ note }))),
        ).not.toContain(note);
      }
    },
  );

  it.each(NAMES)(
    '%s keeps a note of 500 characters whole in the bell',
    (name) => {
      const note = 'ț'.repeat(500);
      expect(render(name, 'bell', 'ro', params({ note }))).toContain(note);
    },
  );

  it.each(NAMES)('%s prints a note naming a placeholder literally', (name) => {
    const mail = render(
      name,
      'email',
      'en',
      params({ note: '{driver} {link} {car}' }),
    );

    expect(mail.text).toContain('{driver} {link} {car}');
  });

  it.each(NAMES)(
    '%s escapes markup in the driver, the car and the note in the html',
    (name) => {
      const mail = render(
        name,
        'email',
        'ro',
        params({
          car: '<img src=x onerror=alert(1)>',
          driver: '"><script>d()</script>',
          note: "<a href='javascript:x'>click</a>",
        }),
      );

      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toContain("<a href='javascript");
    },
  );

  it.each(NAMES)(
    '%s keeps a line break in the car out of the subject',
    (name) => {
      const mail = render(
        name,
        'email',
        'en',
        params({ car: 'Logan\r\nBcc: evil@x.test' }),
      );

      expect(mail.subject).not.toMatch(/[\r\n]/);
    },
  );

  it.each(NAMES)(
    '%s refuses an unknown reason rather than printing it',
    (name) => {
      expect(() =>
        render(name, 'email', 'en', params({ reason: 'constructor' })),
      ).toThrow('unknown cancel reason');
      expect(() =>
        render(name, 'email', 'en', params({ reason: 'nonsense' })),
      ).toThrow('unknown cancel reason');
    },
  );

  it.each(NAMES)('%s refuses a script link in the e-mail', (name) => {
    expect(() =>
      render(name, 'email', 'en', params({ link: 'javascript:alert(1)' })),
    ).toThrow(TemplateError);
  });
  it.each(NAMES)(
    '%s renders a note of 500 characters whole in the e-mail',
    (name) => {
      const note = 'ț'.repeat(500);

      expect(render(name, 'email', 'ro', params({ note })).text).toContain(
        note,
      );
    },
  );

  it('shows the late line in the late text only, in both languages', () => {
    for (const lang of ['ro', 'en']) {
      const early = render('BOOKING_CANCELLED.driver', 'email', lang, params());
      const late = render(
        'BOOKING_CANCELLED.driver_late',
        'email',
        lang,
        params({ variant: 'driver_late' }),
      );
      expect(late.text.length).toBeGreaterThan(early.text.length);
      expect(early.text).not.toMatch(/penali[sz]|penalty/);
    }
  });

  it('has no WhatsApp text for either variant, so none can leak the note', () => {
    for (const name of NAMES) {
      expect(TEMPLATES[name].whatsapp).toBeUndefined();
    }
  });
});
