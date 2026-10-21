import type { Template } from '../templates';

// To a garage's owners, receptionists and the mechanics who answer quotes,
// as the driver declines the garage's quote. Each WhatsApp name is a template
// registered with Brevo.
export const QUOTE_DECLINED_BY_DRIVER: Template = {
  audience: 'garage',
  bell: {
    en: '{driverShortName} declined your quote.',
    ro: '{driverShortName} a refuzat oferta ta.',
  },
  email: {
    en: {
      button: { label: 'Open the quotes sent', link: 'link' },
      lines: ['{driverShortName} declined your quote.', 'Car: {car}.'],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'Quote declined: {car}',
    },
    ro: {
      button: { label: 'Deschide ofertele trimise', link: 'link' },
      lines: ['{driverShortName} a refuzat oferta ta.', 'Mașina: {car}.'],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Ofertă refuzată: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driverShortName: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: '{driverShortName} declined your quote.',
      link: 'link',
      title: 'Quote declined',
    },
    ro: {
      body: '{driverShortName} a refuzat oferta ta.',
      link: 'link',
      title: 'Ofertă refuzată',
    },
  },
  values: { car: 'text', driverShortName: 'text', link: 'link' },
  whatsapp: {
    en: {
      name: 'motorfix_quote_declined_en',
      slots: ['{driverShortName}', '{car}'],
    },
    ro: {
      name: 'motorfix_quote_declined_ro',
      slots: ['{driverShortName}', '{car}'],
    },
  },
};
