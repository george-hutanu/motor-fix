import type { Template } from '../templates';

// To the owners and receptionists of each garage still waiting on a request
// that closed. The driver's own cancel names him by his short name; a close
// because his account closed names nobody. Each WhatsApp name is a template
// registered with Brevo.
const REASON =
  'You get this e‑mail because you answer quote requests for your garage on MotorFix.';
const MOTIV =
  'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.';

export const REQUEST_CANCELLED: Template = {
  audience: 'garage',
  bell: {
    en: '{driver} cancelled the request · {car}',
    ro: '{driver} a anulat cererea · {car}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        '{driver} cancelled the request.',
        'The request for the {car} no longer waits for your quote.',
      ],
      reason: REASON,
      subject: 'Request cancelled: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        '{driver} a anulat cererea.',
        'Cererea pentru {car} nu mai așteaptă oferta ta.',
      ],
      reason: MOTIV,
      subject: 'Cerere anulată: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: '{driver} cancelled the request · {car}',
      link: 'link',
      title: 'Request cancelled',
    },
    ro: {
      body: '{driver} a anulat cererea · {car}',
      link: 'link',
      title: 'Cerere anulată',
    },
  },
  values: { car: 'text', driver: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_request_cancelled_en', slots: ['{driver}', '{car}'] },
    ro: { name: 'motorfix_request_cancelled_ro', slots: ['{driver}', '{car}'] },
  },
};

export const REQUEST_CANCELLED_CLOSED: Template = {
  audience: 'garage',
  bell: {
    en: 'The request was closed · {car}',
    ro: 'Cererea a fost închisă · {car}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        'The request was closed.',
        'The request for the {car} no longer waits for your quote.',
      ],
      reason: REASON,
      subject: 'Request closed: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        'Cererea a fost închisă.',
        'Cererea pentru {car} nu mai așteaptă oferta ta.',
      ],
      reason: MOTIV,
      subject: 'Cerere închisă: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: 'The request was closed · {car}',
      link: 'link',
      title: 'Request closed',
    },
    ro: {
      body: 'Cererea a fost închisă · {car}',
      link: 'link',
      title: 'Cerere închisă',
    },
  },
  values: { car: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_request_closed_en', slots: ['{car}'] },
    ro: { name: 'motorfix_request_closed_ro', slots: ['{car}'] },
  },
};
