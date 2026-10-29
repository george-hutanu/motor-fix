import type { Template } from '../templates';

// To the driver, as the garage corrects the final price it recorded at the
// handover. Each WhatsApp name is a template registered with Brevo.
export const FINAL_PRICE_CORRECTED: Template = {
  audience: 'driver',
  bell: {
    en: '{garage} corrected the final price: {price}',
    ro: '{garage} a corectat prețul final: {price}.',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        '{garage} corrected the final price of your car’s job to {price}.',
        'You will find the job and its price in your requests.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'Final price corrected: {garage}, {price}',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{garage} a corectat prețul final al lucrării la {price}.',
        'Lucrarea și prețul ei sunt în Cererile mele.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Preț final corectat: {garage}, {price}',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    price: 115_000,
  },
  push: {
    en: {
      body: '{garage} · {price}',
      link: 'link',
      title: 'Final price corrected',
    },
    ro: {
      body: '{garage} · {price}',
      link: 'link',
      title: 'Preț final corectat',
    },
  },
  values: { garage: 'text', link: 'link', price: 'lei' },
  whatsapp: {
    en: {
      name: 'motorfix_final_price_corrected_en',
      slots: ['{garage}', '{price}'],
    },
    ro: {
      name: 'motorfix_final_price_corrected_ro',
      slots: ['{garage}', '{price}'],
    },
  },
};
