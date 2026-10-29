import type { Template } from '../templates';

// To the driver, as the garage marks the job done. Each WhatsApp name is a
// template registered with Brevo.
export const JOB_READY: Template = {
  audience: 'driver',
  bell: {
    en: 'Your car is ready. {garage} is expecting you.',
    ro: 'Mașina ta e gata. Te așteptăm la {garage}.',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        'Your car is ready. {garage} is expecting you.',
        'You will find the address and the details in your requests.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'Your car is ready',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        'Mașina ta e gata. Te așteptăm la {garage}.',
        'Adresa și detaliile sunt în Cererile mele.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Mașina ta e gata',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
  },
  push: {
    en: {
      body: '{garage} is expecting you.',
      link: 'link',
      title: 'Your car is ready',
    },
    ro: {
      body: 'Te așteptăm la {garage}.',
      link: 'link',
      title: 'Mașina ta e gata',
    },
  },
  values: { garage: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_job_ready_en', slots: ['{garage}'] },
    ro: { name: 'motorfix_job_ready_ro', slots: ['{garage}'] },
  },
};
