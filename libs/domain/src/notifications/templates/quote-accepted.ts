import type { Template } from '../templates';

// To a garage's owners and receptionists, as a driver accepts the garage's
// quote: the booking waits for their confirmation. Each WhatsApp name is a
// template registered with Brevo.
export const QUOTE_ACCEPTED: Template = {
  audience: 'garage',
  bell: {
    en: '{driver} accepted your quote · {car} · {slot}',
    ro: '{driver} a acceptat oferta ta · {car} · {slot}',
  },
  email: {
    en: {
      button: { label: 'Open the quotes sent', link: 'link' },
      lines: [
        '{driver} accepted your quote for the {car}, on {slot}.',
        'The booking waits for your confirmation.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Quote accepted: {car}',
    },
    ro: {
      button: { label: 'Deschide ofertele trimise', link: 'link' },
      lines: [
        '{driver} a acceptat oferta ta pentru {car}, pe {slot}.',
        'Programarea așteaptă confirmarea ta.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Ofertă acceptată: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
    slot: '2026-10-16T06:00:00.000Z',
  },
  push: {
    en: {
      body: '{driver} · {car} · {slot}',
      link: 'link',
      title: 'Quote accepted',
    },
    ro: {
      body: '{driver} · {car} · {slot}',
      link: 'link',
      title: 'Ofertă acceptată',
    },
  },
  values: { car: 'text', driver: 'text', link: 'link', slot: 'when' },
  whatsapp: {
    en: {
      name: 'motorfix_quote_accepted_en',
      slots: ['{driver}', '{car}', '{slot}'],
    },
    ro: {
      name: 'motorfix_quote_accepted_ro',
      slots: ['{driver}', '{car}', '{slot}'],
    },
  },
};
