import type { Template } from '../templates';

// To the driver, as the garage records that they did not come. Nothing is
// owed. Each WhatsApp name is a template registered with Brevo.
export const NO_SHOW_RECORDED: Template = {
  audience: 'driver',
  bell: {
    en: 'You did not show up at {garage} · {slot}',
    ro: 'Nu te-ai prezentat la {garage} · {slot}',
  },
  email: {
    en: {
      button: { label: 'Open my requests', link: 'link' },
      lines: [
        'You did not show up at {garage} · {slot}.',
        'No fee is charged.',
      ],
      reason: 'You get this e‑mail because you booked a garage on MotorFix.',
      subject: 'You did not show up at {garage}',
    },
    ro: {
      button: { label: 'Deschide Cererile mele', link: 'link' },
      lines: [
        'Nu te-ai prezentat la {garage} · {slot}.',
        'Nu se percepe nicio taxă.',
      ],
      reason:
        'Primești acest e‑mail pentru că ai făcut o programare pe MotorFix.',
      subject: 'Nu te-ai prezentat la {garage}',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/requests',
    slot: '2026-10-16T06:00:00.000Z',
  },
  push: {
    en: {
      body: 'You did not show up at {garage} · {slot}',
      link: 'link',
      title: 'Did not show up',
    },
    ro: {
      body: 'Nu te-ai prezentat la {garage} · {slot}',
      link: 'link',
      title: 'Neprezentat',
    },
  },
  values: { garage: 'text', link: 'link', slot: 'when' },
  whatsapp: {
    en: {
      name: 'motorfix_no_show_recorded_en',
      slots: ['{garage}', '{slot}'],
    },
    ro: {
      name: 'motorfix_no_show_recorded_ro',
      slots: ['{garage}', '{slot}'],
    },
  },
};
