import type { Template } from '../templates';

// To the car's owner, once the garage a shared repair names corrected it.
// Names the garage and the car. Each WhatsApp name is a template registered
// with Brevo, and serves the admin's text below too.
export const REPAIR_UPDATED: Template = {
  audience: 'driver',
  bell: {
    en: "{garage} corrected a repair in {car}'s history.",
    ro: '{garage} a corectat o reparație din istoricul {car}.',
  },
  email: {
    en: {
      button: { label: 'See your cars', link: 'link' },
      lines: [
        "{garage} corrected a repair in {car}'s history.",
        'The history shows the repair as the garage corrected it.',
      ],
      reason:
        'You get this e-mail because you shared a repair with this garage on MotorFix.',
      subject: '{garage} corrected a repair of your {car}',
    },
    ro: {
      button: { label: 'Vezi mașinile tale', link: 'link' },
      lines: [
        '{garage} a corectat o reparație din istoricul {car}.',
        'Istoricul arată reparația așa cum a corectat-o service-ul.',
      ],
      reason:
        'Primești acest e-mail pentru că ai împărțit o reparație cu acest service pe MotorFix.',
      subject: '{garage} a corectat o reparație a mașinii {car}',
    },
  },
  example: {
    car: 'Mini Cooper S 2019',
    garage: 'Garaj Nordic',
    link: 'https://motorfix.example/app/driver?view=cars',
  },
  push: {
    en: {
      body: "{garage} corrected a repair in {car}'s history.",
      link: 'link',
      shorten: 'car',
      title: 'Repair history updated',
    },
    ro: {
      body: '{garage} a corectat o reparație din istoricul {car}.',
      link: 'link',
      shorten: 'car',
      title: 'Istoric de reparații actualizat',
    },
  },
  values: { car: 'text', garage: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_repair_updated_en', slots: ['{garage}', '{car}'] },
    ro: { name: 'motorfix_repair_updated_ro', slots: ['{garage}', '{car}'] },
  },
};

// The same message once the MotorFix admin corrected the repair: MotorFix
// stands where the garage stood, the e-mail says it in its own words.
export const REPAIR_UPDATED_BY_ADMIN: Template = {
  ...REPAIR_UPDATED,
  email: {
    en: {
      button: { label: 'See your cars', link: 'link' },
      lines: [
        "{garage} corrected a repair in {car}'s history.",
        'The history shows the repair as MotorFix corrected it.',
      ],
      reason:
        'You get this e-mail because a repair in your car history on MotorFix was corrected.',
      subject: '{garage} corrected a repair of your {car}',
    },
    ro: {
      button: { label: 'Vezi mașinile tale', link: 'link' },
      lines: [
        '{garage} a corectat o reparație din istoricul {car}.',
        'Istoricul arată reparația așa cum a corectat-o MotorFix.',
      ],
      reason:
        'Primești acest e-mail pentru că o reparație din istoricul mașinii tale pe MotorFix a fost corectată.',
      subject: '{garage} a corectat o reparație a mașinii {car}',
    },
  },
  example: { ...REPAIR_UPDATED.example, garage: 'MotorFix' },
};
