import type { Template } from '../templates';

// A garage proposed a job the catalogue lacks: it waits for an admin's
// approval. The push names the job alone so that the longest garage and job
// names still fit its limits.
export const ADMIN_CATALOGUE_JOB_PENDING: Template = {
  audience: 'admin',
  bell: {
    en: '{garage} proposed the job "{job}"',
    ro: '{garage} a propus lucrarea „{job}”',
  },
  email: {
    en: {
      button: { label: 'Open the dashboard', link: 'dashboard' },
      lines: [
        '{garage} proposed the job "{job}" for the catalogue.',
        'Approve or reject it from the admin dashboard.',
      ],
      reason: 'You get this e-mail because you are a MotorFix admin.',
      subject: 'Job proposed for the catalogue: {job}',
    },
    ro: {
      button: { label: 'Deschide panoul', link: 'dashboard' },
      lines: [
        '{garage} a propus lucrarea „{job}” pentru catalog.',
        'Aprob-o sau respinge-o din panoul de administrare.',
      ],
      reason: 'Primești acest e-mail pentru că ești administrator MotorFix.',
      subject: 'Lucrare propusă pentru catalog: {job}',
    },
  },
  example: {
    dashboard: 'https://motorfix.example/app/admin',
    garage: 'Service Auto Nord',
    job: 'Recondiționare injectoare',
  },
  push: {
    en: {
      body: '"{job}"',
      link: 'dashboard',
      title: 'Job proposed for the catalogue',
    },
    ro: {
      body: '„{job}”',
      link: 'dashboard',
      title: 'Lucrare propusă pentru catalog',
    },
  },
  values: { dashboard: 'link', garage: 'text', job: 'text' },
};
