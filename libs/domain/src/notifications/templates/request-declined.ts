import type { Template } from '../templates';

// To the driver, once a garage's decline is past its undo window. Each
// WhatsApp name is a template registered with Brevo.
export const REQUEST_DECLINED: Template = {
  audience: 'driver',
  bell: {
    en: '{garage} cannot take your request: {reason}.',
    ro: '{garage} nu poate prelua cererea: {reason}.',
  },
  email: {
    en: {
      button: { label: 'See your request', link: 'link' },
      lines: [
        '{garage} cannot take your request: {reason}.',
        'The other garages you asked can still answer.',
      ],
      reason: 'You get this e‑mail because you asked for quotes on MotorFix.',
      subject: 'A garage declined your request',
    },
    ro: {
      button: { label: 'Vezi cererea', link: 'link' },
      lines: [
        '{garage} nu poate prelua cererea: {reason}.',
        'Celelalte service-uri cărora le-ai scris pot răspunde în continuare.',
      ],
      reason: 'Primești acest e‑mail pentru că ai cerut oferte pe MotorFix.',
      subject: 'Un service a refuzat cererea ta',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    reason: 'fully_booked',
  },
  push: {
    en: {
      body: '{garage} cannot take your request: {reason}.',
      link: 'link',
      title: 'Request declined',
    },
    ro: {
      body: '{garage} nu poate prelua cererea: {reason}.',
      link: 'link',
      title: 'Cerere refuzată',
    },
  },
  values: { garage: 'text', link: 'link', reason: 'reason' },
  whatsapp: {
    en: {
      name: 'motorfix_request_declined_en',
      slots: ['{garage}', '{reason}'],
    },
    ro: {
      name: 'motorfix_request_declined_ro',
      slots: ['{garage}', '{reason}'],
    },
  },
};
