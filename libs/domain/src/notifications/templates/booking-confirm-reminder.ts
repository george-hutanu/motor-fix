import type { Template } from '../templates';

// To a garage's owners and receptionists, 12 and 2 hours before an accepted
// booking lapses unconfirmed. Each WhatsApp name is a template registered
// with Brevo.
export const BOOKING_CONFIRM_REMINDER: Template = {
  audience: 'garage',
  bell: {
    en: 'Confirm {driver}’s booking · {car} · {slot} · {left} h left',
    ro: 'Confirmă programarea lui {driver} · {car} · {slot} · mai ai {left} h',
  },
  email: {
    en: {
      button: { label: 'Open the quotes sent', link: 'link' },
      lines: [
        '{driver} accepted your quote for the {car}, on {slot}.',
        'Confirm the booking by {until}, or it lapses and the driver chooses another garage.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Confirm the booking: {car}',
    },
    ro: {
      button: { label: 'Deschide ofertele trimise', link: 'link' },
      lines: [
        '{driver} a acceptat oferta ta pentru {car}, pe {slot}.',
        'Confirmă programarea până la {until}, altfel expiră și șoferul alege alt service.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Confirmă programarea: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    left: 12,
    link: 'https://motorfix.example/app/garage/requests',
    slot: '2026-10-16T06:00:00.000Z',
    until: '2026-10-15T15:00:00.000Z',
  },
  push: {
    en: {
      body: '{driver} · {car} · {slot} · {left} h left',
      link: 'link',
      title: 'Confirm the booking',
    },
    ro: {
      body: '{driver} · {car} · {slot} · mai ai {left} h',
      link: 'link',
      title: 'Confirmă programarea',
    },
  },
  values: {
    car: 'text',
    driver: 'text',
    left: 'num',
    link: 'link',
    slot: 'when',
    until: 'when',
  },
  whatsapp: {
    en: {
      name: 'motorfix_booking_confirm_reminder_en',
      slots: ['{driver}', '{car}', '{slot}', '{left}'],
    },
    ro: {
      name: 'motorfix_booking_confirm_reminder_ro',
      slots: ['{driver}', '{car}', '{slot}', '{left}'],
    },
  },
};
