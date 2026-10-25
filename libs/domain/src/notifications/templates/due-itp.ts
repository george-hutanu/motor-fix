import type { Template } from '../templates';

// The car by brand and model, never its plate, the day the ITP expires and
// when that is, from the day it is sent ("peste 7 zile", "astăzi"). A row sent before it had these values
// falls back to the generic text, its e-mail too. Each WhatsApp name is a template registered
// with Brevo, one per language.
export const DUE_ITP: Template = {
  audience: 'driver',
  bell: {
    en: 'The ITP on your {car} expires on {dueOn}, {left}.',
    ro: 'ITP-ul la {car} expiră pe {dueOn}, {left}.',
  },
  email: {
    en: {
      button: { label: 'See my cars', link: 'cars' },
      lines: [
        'The ITP on your {car} expires on {dueOn}, {left}.',
        'Book the inspection in time.',
      ],
      reason:
        "You get this e-mail because you chose to be told about your cars' due dates. You can change that in Settings › Notifications.",
      subject: 'Your ITP expires on {dueOn}',
    },
    ro: {
      button: { label: 'Vezi mașinile mele', link: 'cars' },
      lines: [
        'ITP-ul la {car} expiră pe {dueOn}, {left}.',
        'Programează inspecția din timp.',
      ],
      reason:
        'Primești acest e-mail pentru că ai ales să fii anunțat despre scadențele mașinilor tale. Poți schimba asta din Setări › Notificări.',
      subject: 'ITP-ul expiră pe {dueOn}',
    },
  },
  example: {
    car: 'BMW 320d',
    cars: 'https://motorfix.example/app/driver/cars',
    dueOn: '2026-11-13',
    left: 30,
  },
  genericEmailWhenMissing: true,
  push: {
    en: {
      body: 'The ITP on your {car} expires on {dueOn}, {left}. Book the inspection in time.',
      link: 'cars',
      shorten: 'car',
      title: 'Your ITP expires soon',
    },
    ro: {
      body: 'ITP-ul la {car} expiră pe {dueOn}, {left}. Programează inspecția din timp.',
      link: 'cars',
      shorten: 'car',
      title: 'ITP-ul expiră curând',
    },
  },
  sms: {
    en: "MotorFix: your car's ITP is due soon. Details in the app.",
    ro: 'MotorFix: ITP-ul mașinii tale expiră curând. Detalii în aplicație.',
  },
  values: { car: 'text', cars: 'link', dueOn: 'date', left: 'days' },
  whatsapp: {
    en: { name: 'motorfix_due_itp_en', slots: [] },
    ro: { name: 'motorfix_due_itp_ro', slots: [] },
  },
};
