import type { Template } from '../templates';

// To the driver, as the garage withdraws a no-show it recorded today: the
// booking stands again. Each WhatsApp name is a template registered with Brevo.
export const NO_SHOW_WITHDRAWN: Template = {
  audience: 'driver',
  bell: {
    en: '{garage} withdrew the no-show · your booking on {slot} stands',
    ro: '{garage} a retras neprezentarea · programarea din {slot} rămâne valabilă',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: ['{garage} withdrew the no-show · your booking on {slot} stands.'],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: '{garage} withdrew the no-show',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{garage} a retras neprezentarea · programarea din {slot} rămâne valabilă.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: '{garage} a retras neprezentarea',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    slot: '2026-10-16T06:00:00.000Z',
  },
  push: {
    en: {
      body: '{garage} withdrew the no-show · your booking on {slot} stands',
      link: 'link',
      title: 'No-show withdrawn',
    },
    ro: {
      body: '{garage} a retras neprezentarea · programarea din {slot} rămâne valabilă',
      link: 'link',
      title: 'Neprezentare retrasă',
    },
  },
  values: { garage: 'text', link: 'link', slot: 'when' },
  whatsapp: {
    en: {
      name: 'motorfix_no_show_withdrawn_en',
      slots: ['{garage}', '{slot}'],
    },
    ro: {
      name: 'motorfix_no_show_withdrawn_ro',
      slots: ['{garage}', '{slot}'],
    },
  },
};
