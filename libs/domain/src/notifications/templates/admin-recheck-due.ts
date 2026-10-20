import type { Template } from '../templates';

// The morning count of published garages an admin has to look up again in
// the RAR register; `garages` arrives already pluralised in the language.
export const ADMIN_RECHECK_DUE: Template = {
  audience: 'admin',
  bell: {
    en: '{garages} to re-check in the RAR register',
    ro: '{garages} de reverificat în registrul RAR',
  },
  email: {
    en: {
      button: { label: 'Open the list', link: 'dashboard' },
      lines: [
        '{garages} to re-check in the RAR register.',
        'Open the list under Garages in the admin dashboard.',
      ],
      reason: 'You get this e-mail because you are a MotorFix admin.',
      subject: '{garages} to re-check in the RAR register',
    },
    ro: {
      button: { label: 'Deschide lista', link: 'dashboard' },
      lines: [
        '{garages} de reverificat în registrul RAR.',
        'Deschide lista din Service-uri, în panoul de administrare.',
      ],
      reason: 'Primești acest e-mail pentru că ești administrator MotorFix.',
      subject: '{garages} de reverificat în registrul RAR',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/admin/garages',
    garages: '12 service-uri',
  },
  push: {
    en: {
      body: 'Open the list under Garages in the admin dashboard.',
      link: 'dashboard',
      title: '{garages} to re-check in the RAR register',
    },
    ro: {
      body: 'Deschide lista din Service-uri, în panoul de administrare.',
      link: 'dashboard',
      title: '{garages} de reverificat în registrul RAR',
    },
  },
  values: { dashboard: 'link', garages: 'text' },
};
