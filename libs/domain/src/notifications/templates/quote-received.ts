import type { Template } from '../templates';

// To the driver, as a garage answers their request with a quote. Each
// WhatsApp name is a template registered with Brevo.
export const QUOTE_RECEIVED: Template = {
  audience: 'driver',
  bell: {
    en: 'New quote from {garage}: {range} lei',
    ro: 'Ofertă nouă de la {garage}: {range} lei',
  },
  email: {
    en: {
      button: { label: 'See the quote', link: 'link' },
      lines: ['{garage} answered your request: {range} lei.'],
      reason: 'You get this e‑mail because you asked for quotes on MotorFix.',
      subject: 'New quote from {garage}: {range} lei',
    },
    ro: {
      button: { label: 'Vezi oferta', link: 'link' },
      lines: ['{garage} ți‑a răspuns la cerere: {range} lei.'],
      reason: 'Primești acest e‑mail pentru că ai cerut oferte pe MotorFix.',
      subject: 'Ofertă nouă de la {garage}: {range} lei',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    range: '650–800',
  },
  push: {
    en: {
      body: 'New quote from {garage}: {range} lei',
      link: 'link',
      title: 'New quote',
    },
    ro: {
      body: 'Ofertă nouă de la {garage}: {range} lei',
      link: 'link',
      title: 'Ofertă nouă',
    },
  },
  values: { garage: 'text', link: 'link', range: 'text' },
  whatsapp: {
    en: { name: 'motorfix_quote_received_en', slots: ['{garage}', '{range}'] },
    ro: { name: 'motorfix_quote_received_ro', slots: ['{garage}', '{range}'] },
  },
};

// Several quotes within the grouping window go out as one e-mail.
export const QUOTE_RECEIVED_GROUPED: Template = {
  audience: 'driver',
  email: {
    en: {
      button: { label: 'Compare the quotes', link: 'app' },
      lines: ['Open MotorFix to compare them.'],
      reason: 'You get this e-mail because you asked for quotes on MotorFix.',
      subject: '{count} new quotes',
    },
    ro: {
      button: { label: 'Compară ofertele', link: 'app' },
      lines: ['Deschide MotorFix ca să le compari.'],
      reason: 'Primești acest e-mail pentru că ai cerut oferte pe MotorFix.',
      subject: '{count} oferte noi',
    },
  },
  example: { count: 3 },
  values: { count: 'count' },
};
