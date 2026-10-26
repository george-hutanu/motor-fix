import type { Template } from '../templates';

// The car by brand and model, never its plate, the day its oil service is
// estimated for (from the kilometres it is driven) and how far off that is. A
// row sent before it had these values falls back to the generic text, its
// e-mail too. Each WhatsApp name is a template registered with Brevo, one per
// language.
export const SERVICE_DUE: Template = {
  audience: 'driver',
  bell: {
    en: 'The oil service on your {car} is estimated for {dueOn}, {left}.',
    ro: 'Schimbul de ulei la {car} este estimat pe {dueOn}, {left}.',
  },
  email: {
    en: {
      button: { label: 'See my cars', link: 'cars' },
      lines: [
        'The oil service on your {car} is estimated for {dueOn}, {left}.',
        'Book the oil service in time.',
      ],
      reason:
        "You get this e-mail because you chose to be told about your cars' due dates. You can change that in Settings › Notifications.",
      subject: 'Your oil service is estimated for {dueOn}',
    },
    ro: {
      button: { label: 'Vezi mașinile mele', link: 'cars' },
      lines: [
        'Schimbul de ulei la {car} este estimat pe {dueOn}, {left}.',
        'Programează schimbul de ulei din timp.',
      ],
      reason:
        'Primești acest e-mail pentru că ai ales să fii anunțat despre scadențele mașinilor tale. Poți schimba asta din Setări › Notificări.',
      subject: 'Schimbul de ulei este estimat pe {dueOn}',
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
      body: 'The oil service on your {car} is estimated for {dueOn}, {left}. Book the oil service in time.',
      link: 'cars',
      shorten: 'car',
      title: 'Your oil service is coming up',
    },
    ro: {
      body: 'Schimbul de ulei la {car} este estimat pe {dueOn}, {left}. Programează schimbul de ulei din timp.',
      link: 'cars',
      shorten: 'car',
      title: 'Schimbul de ulei se apropie',
    },
  },
  sms: {
    en: "MotorFix: your car's oil service is due soon. Details in the app.",
    ro: 'MotorFix: schimbul de ulei se apropie. Detalii în aplicație.',
  },
  values: { car: 'text', cars: 'link', dueOn: 'date', left: 'days' },
  whatsapp: {
    en: { name: 'motorfix_service_due_en', slots: [] },
    ro: { name: 'motorfix_service_due_ro', slots: [] },
  },
};
