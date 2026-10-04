import type { Template } from '../templates';

// Only the grouped e-mail so far; the single quote's texts come with its epic.
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
