import type { Template } from '../templates';

// The admin writes the title and the text; the stop link is the driver's own.
export const NEWS: Template = {
  audience: 'driver',
  bell: { en: '{title}', ro: '{title}' },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'app' },
      lines: ['{text}'],
      reason:
        'You get this e-mail because you chose to get MotorFix news, at most one e-mail a month.',
      stop: { label: 'Stop MotorFix news', link: 'unsubscribe' },
      subject: '{title}',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'app' },
      lines: ['{text}'],
      reason:
        'Primești acest e-mail pentru că ai ales să primești noutăți MotorFix, cel mult un e-mail pe lună.',
      stop: { label: 'Nu mai vreau noutăți', link: 'unsubscribe' },
      subject: '{title}',
    },
  },
  example: {
    text: 'Primele service-uri din Cluj sunt pe MotorFix.',
    title: 'Noutăți din octombrie',
    unsubscribe: 'https://motorfix.example/ro/unsubscribe/token',
  },
  values: { text: 'text', title: 'text', unsubscribe: 'link' },
};
