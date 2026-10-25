import type { Template } from '../templates';

// On day 2 and day 5, to the staff who may answer quotes at each garage a
// request still waits on. Each WhatsApp name is a template registered with
// Brevo.
export const REQUEST_REMINDER: Template = {
  audience: 'garage',
  bell: {
    en: '{driver}’s request is still waiting: {car}',
    ro: 'Cererea lui {driver} așteaptă răspuns: {car}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        '{driver}’s request for the {car} is still waiting for your quote.',
        'It expires seven days after it was sent.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Still waiting for your quote: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        'Cererea lui {driver} pentru {car} încă așteaptă oferta ta.',
        'Expiră la șapte zile după ce a fost trimisă.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Încă așteaptă oferta ta: {car}',
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
      title: 'Request waiting',
    },
    ro: {
      body: '{driver} · {car}',
      link: 'link',
      shorten: 'car',
      title: 'Cerere în așteptare',
    },
  },
  values: { car: 'text', driver: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_request_reminder_en', slots: ['{driver}', '{car}'] },
    ro: { name: 'motorfix_request_reminder_ro', slots: ['{driver}', '{car}'] },
  },
};
