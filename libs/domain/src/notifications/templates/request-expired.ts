import type { Template } from '../templates';

// As a request's seven days end: the driver, when it closed with no quote
// left, is sent to ask other garages; each garage that never answered learns
// it went. `side` picks the text. Each WhatsApp name is a template
// registered with Brevo.
export const REQUEST_EXPIRED_DRIVER: Template = {
  audience: 'driver',
  bell: {
    en: 'Your request for the {car} expired. Ask other garages for quotes.',
    ro: 'Cererea pentru {car} a expirat. Cere oferte de la alte service-uri.',
  },
  email: {
    en: {
      button: { label: 'Ask other garages for quotes', link: 'link' },
      lines: [
        'Your request for the {car} expired: seven days passed with no quote you could choose.',
        'Ask other garages for quotes, with the same car and jobs.',
      ],
      reason: 'You get this e‑mail because you asked for quotes on MotorFix.',
      subject: 'Your request for the {car} expired',
    },
    ro: {
      button: { label: 'Cere oferte de la alte service-uri', link: 'link' },
      lines: [
        'Cererea pentru {car} a expirat: au trecut șapte zile fără o ofertă pe care s-o poți alege.',
        'Cere oferte de la alte service-uri, cu aceeași mașină și aceleași lucrări.',
      ],
      reason: 'Primești acest e‑mail pentru că ai cerut oferte pe MotorFix.',
      subject: 'Cererea pentru {car} a expirat',
    },
  },
  example: {
    car: 'Mini Cooper S',
    link: 'https://motorfix.example/app/driver/requests/0a9b8c7d',
  },
  push: {
    en: {
      body: 'Ask other garages for quotes for the {car}.',
      link: 'link',
      title: 'Request expired',
    },
    ro: {
      body: 'Cere oferte de la alte service-uri pentru {car}.',
      link: 'link',
      title: 'Cerere expirată',
    },
  },
  values: { car: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_request_expired_driver_en', slots: ['{car}'] },
    ro: { name: 'motorfix_request_expired_driver_ro', slots: ['{car}'] },
  },
};

export const REQUEST_EXPIRED_GARAGE: Template = {
  audience: 'garage',
  bell: {
    en: '{driver}’s request expired: {car}',
    ro: 'Cererea lui {driver} a expirat: {car}',
  },
  email: {
    en: {
      button: { label: 'Open the quote requests', link: 'link' },
      lines: [
        '{driver}’s request for the {car} expired after seven days without your quote.',
        'It can no longer be answered.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Request expired: {car}',
    },
    ro: {
      button: { label: 'Deschide Cererile de ofertă', link: 'link' },
      lines: [
        'Cererea lui {driver} pentru {car} a expirat după șapte zile fără oferta ta.',
        'Nu mai poate primi răspuns.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Cerere expirată: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: { body: '{driver} · {car}', link: 'link', title: 'Request expired' },
    ro: { body: '{driver} · {car}', link: 'link', title: 'Cerere expirată' },
  },
  values: { car: 'text', driver: 'text', link: 'link' },
  whatsapp: {
    en: {
      name: 'motorfix_request_expired_garage_en',
      slots: ['{driver}', '{car}'],
    },
    ro: {
      name: 'motorfix_request_expired_garage_ro',
      slots: ['{driver}', '{car}'],
    },
  },
};
