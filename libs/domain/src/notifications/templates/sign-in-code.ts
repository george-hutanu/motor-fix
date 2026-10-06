import type { Template } from '../templates';

// The code alone: WhatsApp approved each language's text with Brevo, which
// fills in the code and its minutes. No link and no name, so the message is
// of no use to anyone who did not ask for it.
export const SIGN_IN_CODE: Template = {
  audience: 'any',
  example: { code: '123456', minutes: 5 },
  values: { code: 'text', minutes: 'num' },
  whatsapp: {
    en: { name: 'motorfix_sign_in_code_en', slots: ['{code}', '{minutes}'] },
    ro: { name: 'motorfix_sign_in_code_ro', slots: ['{code}', '{minutes}'] },
  },
};
