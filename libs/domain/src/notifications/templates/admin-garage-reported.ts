import type { Template } from '../templates';

// A driver reported a listed garage and its verification file went back to
// review. `text` is the report as written; `brief` is it cut to fit a push.
export const ADMIN_GARAGE_REPORTED: Template = {
  audience: 'admin',
  bell: {
    en: 'A driver reported {garage}. Its verification file is back in review.',
    ro: 'Un șofer a raportat {garage}. Dosarul de verificare e din nou în analiză.',
  },
  email: {
    en: {
      button: { label: 'Open the dashboard', link: 'dashboard' },
      lines: [
        'A driver reported {garage}. Its verification file is back in review.',
        'What they wrote: {text}',
      ],
      reason:
        'You get this e-mail because you are a MotorFix admin and a listed garage was reported.',
      subject: '{garage} was reported',
    },
    ro: {
      button: { label: 'Deschide panoul', link: 'dashboard' },
      lines: [
        'Un șofer a raportat {garage}. Dosarul de verificare e din nou în analiză.',
        'Ce a scris: {text}',
      ],
      reason:
        'Primești acest e-mail pentru că ești administrator MotorFix și un service listat a fost raportat.',
      subject: '{garage} a fost raportat',
    },
  },
  example: {
    brief: 'Au cerut plata înainte și nu au reparat mașina.',
    dashboard: 'https://motorfix.example/app/admin',
    garage: 'Atelier Dinamo',
    text: 'Au cerut plata înainte și nu au reparat mașina.',
  },
  push: {
    en: { body: '{brief}', link: 'dashboard', title: '{garage} was reported' },
    ro: {
      body: '{brief}',
      link: 'dashboard',
      title: '{garage} a fost raportat',
    },
  },
  values: { brief: 'text', dashboard: 'link', garage: 'text', text: 'text' },
};
