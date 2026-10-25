import type { Template } from '../templates';

// A waiting quote's seven days ended without an answer: the driver learns
// whose quote went, the garage's desk which driver it was sent to. `side`
// picks the text. Each WhatsApp name is a template registered with Brevo.
export const QUOTE_EXPIRED_DRIVER: Template = {
  audience: 'driver',
  bell: {
    en: 'The quote from {garage} for the {car} expired',
    ro: 'Oferta de la {garage} pentru {car} a expirat',
  },
  email: {
    en: {
      button: { label: 'Open the request', link: 'link' },
      lines: [
        'The quote from {garage} for the {car} expired: seven days passed without an answer.',
        'The request stays open for the other quotes, if any are still waiting.',
      ],
      reason: 'You get this e‑mail because you asked for quotes on MotorFix.',
      subject: 'A quote for the {car} expired',
    },
    ro: {
      button: { label: 'Deschide cererea', link: 'link' },
      lines: [
        'Oferta de la {garage} pentru {car} a expirat: au trecut șapte zile fără răspuns.',
        'Cererea rămâne deschisă pentru celelalte oferte, dacă mai așteaptă vreuna.',
      ],
      reason: 'Primești acest e‑mail pentru că ai cerut oferte pe MotorFix.',
      subject: 'O ofertă pentru {car} a expirat',
    },
  },
  example: {
    car: 'Mini Cooper S',
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests/0a9b8c7d',
  },
  push: {
    en: {
      body: '{garage} · {car}',
      link: 'link',
      shorten: 'car',
      title: 'Quote expired',
    },
    ro: {
      body: '{garage} · {car}',
      link: 'link',
      shorten: 'car',
      title: 'Ofertă expirată',
    },
  },
  values: { car: 'text', garage: 'text', link: 'link' },
  whatsapp: {
    en: {
      name: 'motorfix_quote_expired_driver_en',
      slots: ['{garage}', '{car}'],
    },
    ro: {
      name: 'motorfix_quote_expired_driver_ro',
      slots: ['{garage}', '{car}'],
    },
  },
};

export const QUOTE_EXPIRED_GARAGE: Template = {
  audience: 'garage',
  bell: {
    en: 'Your quote to {driver} expired: {car}',
    ro: 'Oferta trimisă lui {driver} a expirat: {car}',
  },
  email: {
    en: {
      button: { label: 'Open the quote requests', link: 'link' },
      lines: [
        'Your quote to {driver} for the {car} expired after seven days without an answer.',
        'It can no longer be accepted.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Quote expired: {car}',
    },
    ro: {
      button: { label: 'Deschide Cererile de ofertă', link: 'link' },
      lines: [
        'Oferta trimisă lui {driver} pentru {car} a expirat după șapte zile fără răspuns.',
        'Nu mai poate fi acceptată.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Ofertă expirată: {car}',
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
      shorten: 'car',
      title: 'Quote expired',
    },
    ro: {
      body: '{driver} · {car}',
      link: 'link',
      shorten: 'car',
      title: 'Ofertă expirată',
    },
  },
  values: { car: 'text', driver: 'text', link: 'link' },
  whatsapp: {
    en: {
      name: 'motorfix_quote_expired_garage_en',
      slots: ['{driver}', '{car}'],
    },
    ro: {
      name: 'motorfix_quote_expired_garage_ro',
      slots: ['{driver}', '{car}'],
    },
  },
};
