import type { Template } from '../templates';

// An outside uptime check of Home or the API failed (down) or passed again
// (back). `at` is when that happened.
const example = {
  at: '2026-10-10T03:04:05.000Z',
  dashboard: 'https://motorfix.example/app/admin',
  service: 'api',
};
const values = { at: 'when', dashboard: 'link', service: 'text' } as const;
const button = {
  en: { label: 'Open the admin panel', link: 'dashboard' },
  ro: { label: 'Deschide panoul', link: 'dashboard' },
};

export const ADMIN_OUTAGE_ALERT_DOWN: Template = {
  audience: 'admin',
  bell: {
    en: '{service} is down since {at}.',
    ro: '{service} nu răspunde de la {at}.',
  },
  email: {
    en: {
      button: button.en,
      lines: [
        'The {service} check has failed since {at}. The alert and its graph are in Grafana.',
      ],
      reason:
        'You get this e-mail because you are a MotorFix admin and an uptime check failed.',
      subject: '{service} is down',
    },
    ro: {
      button: button.ro,
      lines: [
        'Verificarea {service} eșuează de la {at}. Alerta și graficul ei sunt în Grafana.',
      ],
      reason:
        'Primești acest e-mail pentru că ești administrator MotorFix și o verificare de disponibilitate a eșuat.',
      subject: '{service} nu răspunde',
    },
  },
  example,
  push: {
    en: {
      body: 'Failing since {at}.',
      link: 'dashboard',
      title: '{service} is down',
    },
    ro: {
      body: 'Eșuează de la {at}.',
      link: 'dashboard',
      title: '{service} nu răspunde',
    },
  },
  values,
};

export const ADMIN_OUTAGE_ALERT_BACK: Template = {
  audience: 'admin',
  bell: {
    en: '{service} is back since {at}.',
    ro: '{service} a revenit de la {at}.',
  },
  email: {
    en: {
      button: button.en,
      lines: ['The {service} check passed again at {at}.'],
      reason:
        'You get this e-mail because you are a MotorFix admin and an uptime check passed again.',
      subject: '{service} is back',
    },
    ro: {
      button: button.ro,
      lines: ['Verificarea {service} a trecut din nou la {at}.'],
      reason:
        'Primești acest e-mail pentru că ești administrator MotorFix și o verificare de disponibilitate a trecut din nou.',
      subject: '{service} a revenit',
    },
  },
  example,
  push: {
    en: {
      body: 'Passing again since {at}.',
      link: 'dashboard',
      title: '{service} is back',
    },
    ro: {
      body: 'Trece din nou de la {at}.',
      link: 'dashboard',
      title: '{service} a revenit',
    },
  },
  values,
};
