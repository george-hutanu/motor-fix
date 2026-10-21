import type { Template } from '../templates';

// As a booking lapses unconfirmed: the driver chooses another quote, and the
// garage's owners and receptionists learn it went. `side` picks the text.
// Each WhatsApp name is a template registered with Brevo.
export const BOOKING_LAPSED_DRIVER: Template = {
  audience: 'driver',
  bell: {
    en: 'The garage did not confirm. Choose another quote.',
    ro: 'Service‑ul nu a confirmat. Alege altă ofertă.',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        '{garage} did not confirm your booking in time, so it lapsed.',
        'Your request is open again: choose another quote.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'The booking was not confirmed',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{garage} nu ți-a confirmat programarea la timp, așa că a expirat.',
        'Cererea ta e din nou deschisă: alege altă ofertă.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Programarea nu a fost confirmată',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/requests',
  },
  push: {
    en: {
      body: 'The garage did not confirm. Choose another quote.',
      link: 'link',
      title: 'Booking not confirmed',
    },
    ro: {
      body: 'Service‑ul nu a confirmat. Alege altă ofertă.',
      link: 'link',
      title: 'Programare neconfirmată',
    },
  },
  values: { garage: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_booking_lapsed_driver_en', slots: ['{garage}'] },
    ro: { name: 'motorfix_booking_lapsed_driver_ro', slots: ['{garage}'] },
  },
};

export const BOOKING_LAPSED_GARAGE: Template = {
  audience: 'garage',
  bell: {
    en: '{driver}’s booking lapsed unconfirmed',
    ro: 'Programarea lui {driver} a expirat neconfirmată',
  },
  email: {
    en: {
      button: { label: 'Open the quotes sent', link: 'link' },
      lines: [
        '{driver}’s booking for the {car} was not confirmed in time and lapsed.',
        'The driver may now choose another garage.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Booking lapsed: {car}',
    },
    ro: {
      button: { label: 'Deschide ofertele trimise', link: 'link' },
      lines: [
        'Programarea lui {driver} pentru {car} nu a fost confirmată la timp și a expirat.',
        'Șoferul poate alege acum alt service.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Programare expirată: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: '{driver} · {car}',
      link: 'link',
      title: 'Booking lapsed',
    },
    ro: {
      body: '{driver} · {car}',
      link: 'link',
      title: 'Programare expirată',
    },
  },
  values: { car: 'text', driver: 'text', link: 'link' },
  whatsapp: {
    en: {
      name: 'motorfix_booking_lapsed_garage_en',
      slots: ['{driver}', '{car}'],
    },
    ro: {
      name: 'motorfix_booking_lapsed_garage_ro',
      slots: ['{driver}', '{car}'],
    },
  },
};
