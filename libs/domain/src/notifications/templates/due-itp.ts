import type { Template } from '../templates';

// The phone texts and the bell's; the e-mail is still the generic one. The
// bell names the car and the day; a row sent before it had the car falls back
// to the generic text. Each WhatsApp name is a template registered with
// Brevo, one per language.
export const DUE_ITP: Template = {
  audience: 'driver',
  bell: {
    en: 'The ITP of your {car} is due on {dueOn}',
    ro: 'ITP-ul la {car} expiră pe {dueOn}',
  },
  example: { car: 'Dacia Logan', dueOn: '2026-11-09' },
  sms: {
    en: "MotorFix: your car's ITP is due soon. Details in the app.",
    ro: 'MotorFix: ITP-ul mașinii tale expiră curând. Detalii în aplicație.',
  },
  values: { car: 'text', dueOn: 'day' },
  whatsapp: {
    en: { name: 'motorfix_due_itp_en', slots: [] },
    ro: { name: 'motorfix_due_itp_ro', slots: [] },
  },
};
