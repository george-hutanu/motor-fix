import type { Template } from '../templates';

// To the driver, as the garage starts work. The actor is the mechanic's first
// name or the garage; the car comes as a whole phrase, article included.
export const JOB_STARTED: Template = {
  audience: 'driver',
  bell: {
    en: '{actor} started work on {car}.',
    ro: '{actor} a început lucrul la {car}.',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        '{actor} started work on {car}.',
        'You can follow the work in your requests.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'Work on {car} has started',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        '{actor} a început lucrul la {car}.',
        'Poți urmări lucrarea în Cererile mele.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Lucrul la {car} a început',
    },
  },
  example: {
    actor: 'Mihai',
    car: 'Dacia Logan',
    link: 'https://motorfix.example/app/driver/requests',
  },
  push: {
    en: {
      body: '{actor} started work on {car}.',
      link: 'link',
      title: 'Work has started',
    },
    ro: {
      body: '{actor} a început lucrul la {car}.',
      link: 'link',
      title: 'Lucrul a început',
    },
  },
  values: { actor: 'text', car: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_job_started_en', slots: ['{actor}', '{car}'] },
    ro: { name: 'motorfix_job_started_ro', slots: ['{actor}', '{car}'] },
  },
};
