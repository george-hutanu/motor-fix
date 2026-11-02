import type { Template } from '../templates';

// As a driver asks to move a confirmed booking: the garage's owners and
// receptionists learn both times. Each WhatsApp name is a template
// registered with Brevo.
export const BOOKING_MOVE_REQUESTED: Template = {
  audience: 'garage',
  bell: {
    en: '{driver} asks to move the booking · {car} · from {slot} to {to}',
    ro: '{driver} cere mutarea programării · {car} · de la {slot} la {to}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        '{driver} asks to move the booking for the {car} from {slot} to {to}.',
        'The booking keeps its time until you answer.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Move asked: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        '{driver} cere mutarea programării pentru {car} de la {slot} la {to}.',
        'Programarea își păstrează ora până răspunzi.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Cerere de mutare: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
    slot: '2026-10-16T06:00:00.000Z',
    to: '2026-10-19T06:00:00.000Z',
  },
  push: {
    en: {
      body: '{driver} · {car} · {slot} → {to}',
      link: 'link',
      title: 'Booking move asked',
    },
    ro: {
      body: '{driver} · {car} · {slot} → {to}',
      link: 'link',
      title: 'Cerere de mutare a programării',
    },
  },
  values: {
    car: 'text',
    driver: 'text',
    link: 'link',
    slot: 'when',
    to: 'when',
  },
  whatsapp: {
    en: {
      name: 'motorfix_booking_move_requested_en',
      slots: ['{driver}', '{car}', '{slot}', '{to}'],
    },
    ro: {
      name: 'motorfix_booking_move_requested_ro',
      slots: ['{driver}', '{car}', '{slot}', '{to}'],
    },
  },
};

// As the garage lets a driver's move lapse unanswered: the booking stays.
export const BOOKING_MOVE_LAPSED: Template = {
  audience: 'driver',
  bell: {
    en: 'The garage did not confirm the move. The booking stays {slot}.',
    ro: 'Service‑ul nu a confirmat mutarea. Programarea rămâne {slot}.',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        '{garage} did not answer your move in time.',
        'Your booking stays {slot}.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'Move not confirmed: {garage}',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{garage} nu a răspuns la timp la mutarea cerută.',
        'Programarea ta rămâne {slot}.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Mutarea nu a fost confirmată: {garage}',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    slot: '2026-10-16T06:00:00.000Z',
  },
  push: {
    en: {
      body: '{garage} · {slot}',
      link: 'link',
      title: 'Move not confirmed',
    },
    ro: {
      body: '{garage} · {slot}',
      link: 'link',
      title: 'Mutare neconfirmată',
    },
  },
  values: { garage: 'text', link: 'link', slot: 'when' },
  whatsapp: {
    en: {
      name: 'motorfix_booking_move_lapsed_en',
      slots: ['{garage}', '{slot}'],
    },
    ro: {
      name: 'motorfix_booking_move_lapsed_ro',
      slots: ['{garage}', '{slot}'],
    },
  },
};
