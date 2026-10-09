import type { Template } from '../templates';

// To a garage's staff who may answer quotes, as a driver's request reaches
// the garage. Each WhatsApp name is a template registered with Brevo.
export const REQUEST_RECEIVED: Template = {
  audience: 'garage',
  bell: {
    en: 'New request: {car} · {job}',
    ro: 'Cerere nouă: {car} · {job}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: ['A driver asks for a quote: {car}, {job}.'],
      reason:
        'You get this e‑mail because you answer quote requests for your garage on MotorFix.',
      subject: 'New request: {car}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: ['Un șofer cere o ofertă: {car}, {job}.'],
      reason:
        'Primești acest e‑mail pentru că răspunzi la cererile de ofertă ale service‑ului tău pe MotorFix.',
      subject: 'Cerere nouă: {car}',
    },
  },
  example: {
    car: 'Dacia Logan',
    job: 'Schimb ulei',
    link: 'https://motorfix.example/app/garage/requests',
  },
  push: {
    en: {
      body: 'New request: {car} · {job}',
      link: 'link',
      title: 'New request',
    },
    ro: {
      body: 'Cerere nouă: {car} · {job}',
      link: 'link',
      title: 'Cerere nouă',
    },
  },
  values: { car: 'text', job: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_request_received_en', slots: ['{car}', '{job}'] },
    ro: { name: 'motorfix_request_received_ro', slots: ['{car}', '{job}'] },
  },
};
