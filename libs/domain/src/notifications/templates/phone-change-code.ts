import type { Template } from '../templates';

// The code that confirms a new number in Setări: WhatsApp approved each
// language's text with Brevo, which fills in the code and its minutes. No
// link and no name, as the sign-in code.
export const PHONE_CHANGE_CODE: Template = {
  audience: 'any',
  example: { code: '123456', minutes: 5 },
  values: { code: 'text', minutes: 'num' },
  whatsapp: {
    en: {
      name: 'motorfix_phone_change_code_en',
      slots: ['{code}', '{minutes}'],
    },
    ro: {
      name: 'motorfix_phone_change_code_ro',
      slots: ['{code}', '{minutes}'],
    },
  },
};
