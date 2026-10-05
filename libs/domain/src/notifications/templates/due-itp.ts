import type { Template } from '../templates';

// Only the phone texts so far; the e-mail and the bell come with the
// reminders, and use the generic ones until then. Each WhatsApp name is a
// template registered with Brevo, one per language.
export const DUE_ITP: Template = {
  audience: 'driver',
  example: {},
  sms: {
    en: "MotorFix: your car's ITP is due soon. Details in the app.",
    ro: 'MotorFix: ITP-ul mașinii tale expiră curând. Detalii în aplicație.',
  },
  values: {},
  whatsapp: {
    en: { name: 'motorfix_due_itp_en', slots: [] },
    ro: { name: 'motorfix_due_itp_ro', slots: [] },
  },
};
