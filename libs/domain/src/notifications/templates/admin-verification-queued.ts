import type { Template } from '../templates';

// A garage sent its verification file, or sent it again after more was
// asked: it waits in the admins' queue.
export const ADMIN_VERIFICATION_QUEUED: Template = {
  audience: 'admin',
  bell: {
    en: '{garage} sent its verification file',
    ro: '{garage} a trimis dosarul de verificare',
  },
  email: {
    en: {
      button: { label: 'Open the dashboard', link: 'dashboard' },
      lines: [
        '{garage} sent its verification file.',
        'Open the queue from the admin dashboard.',
      ],
      reason: 'You get this e-mail because you are a MotorFix admin.',
      subject: '{garage} sent its verification file',
    },
    ro: {
      button: { label: 'Deschide panoul', link: 'dashboard' },
      lines: [
        '{garage} a trimis dosarul de verificare.',
        'Deschide coada din panoul de administrare.',
      ],
      reason: 'Primești acest e-mail pentru că ești administrator MotorFix.',
      subject: '{garage} a trimis dosarul de verificare',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/admin',
    garage: 'Auto Vest Motors',
  },
  push: {
    en: {
      body: 'Open the queue from the admin dashboard.',
      link: 'dashboard',
      title: '{garage} sent its verification file',
    },
    ro: {
      body: 'Deschide coada din panoul de administrare.',
      link: 'dashboard',
      title: '{garage} a trimis dosarul de verificare',
    },
  },
  values: { dashboard: 'link', garage: 'text' },
};
