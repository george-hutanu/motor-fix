import type { Template } from '../templates';

// To the driver, as the garage confirms the booking. Each WhatsApp name is a
// template registered with Brevo.
export const BOOKING_CONFIRMED: Template = {
  audience: 'driver',
  bell: {
    en: 'Booking confirmed · {garage} · {slot}',
    ro: 'Programare confirmată · {garage} · {slot}',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        '{garage} confirmed your booking on {slot}.',
        'You will find the address and the details in your requests.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'Booking confirmed: {garage}, {slot}',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{garage} ți-a confirmat programarea din {slot}.',
        'Adresa și detaliile sunt în Cererile mele.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Programare confirmată: {garage}, {slot}',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    slot: '2026-10-16T06:00:00.000Z',
  },
  push: {
    en: { body: '{garage} · {slot}', link: 'link', title: 'Booking confirmed' },
    ro: {
      body: '{garage} · {slot}',
      link: 'link',
      title: 'Programare confirmată',
    },
  },
  values: { garage: 'text', link: 'link', slot: 'when' },
  whatsapp: {
    en: {
      name: 'motorfix_booking_confirmed_en',
      slots: ['{garage}', '{slot}'],
    },
    ro: {
      name: 'motorfix_booking_confirmed_ro',
      slots: ['{garage}', '{slot}'],
    },
  },
};
