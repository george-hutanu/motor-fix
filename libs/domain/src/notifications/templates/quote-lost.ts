import type { Template } from '../templates';

// To the owners and receptionists of each garage whose waiting quote closed
// as the driver confirmed another garage's. Names the car only, so the
// garage knows which request it was. Each WhatsApp name is a template
// registered with Brevo.
export const QUOTE_LOST: Template = {
  audience: 'garage',
  bell: {
    en: 'The customer chose another garage · {car}',
    ro: 'Clientul a ales alt service · {car}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        'The customer chose another garage.',
        'Your quote for the {car} no longer waits for an answer.',
      ],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Quote lost: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        'Clientul a ales alt service.',
        'Oferta ta pentru {car} nu mai așteaptă un răspuns.',
      ],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Ofertă pierdută: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: 'The customer chose another garage · {car}',
      link: 'link',
      title: 'Quote lost',
    },
    ro: {
      body: 'Clientul a ales alt service · {car}',
      link: 'link',
      title: 'Ofertă pierdută',
    },
  },
  values: { car: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_quote_lost_en', slots: ['{car}'] },
    ro: { name: 'motorfix_quote_lost_ro', slots: ['{car}'] },
  },
};
