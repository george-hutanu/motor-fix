import type { Template } from '../templates';

// For a type whose owning story has not written its texts yet.
export const GENERIC: Template = {
  audience: 'any',
  bell: {
    en: 'You have a new notification',
    ro: 'Ai o notificare nouă',
  },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'app' },
      lines: ['Open MotorFix to see it.'],
      reason: 'You get this e-mail because of your MotorFix account.',
      subject: 'You have a new notification',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'app' },
      lines: ['Deschide MotorFix ca s-o vezi.'],
      reason: 'Primești acest e-mail pentru contul tău MotorFix.',
      subject: 'Ai o notificare nouă',
    },
  },
  example: {},
  values: {},
};

export const GENERIC_GROUPED: Template = {
  audience: 'any',
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'app' },
      lines: ['Open MotorFix to see them.'],
      reason: 'You get this e-mail because of your MotorFix account.',
      subject: 'You have {count} new notifications',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'app' },
      lines: ['Deschide MotorFix ca să le vezi.'],
      reason: 'Primești acest e-mail pentru contul tău MotorFix.',
      subject: 'Ai {count} notificări noi',
    },
  },
  example: { count: 3 },
  values: { count: 'count' },
};
