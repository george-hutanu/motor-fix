import type { Template } from '../templates';

const example = { link: 'https://motorfix.example/account?t=example' };
const values = { link: 'link' } as const;

export const EMAIL_CHECK: Template = {
  audience: 'any',
  bell: {
    en: 'Confirm your e-mail address.',
    ro: 'Confirmă adresa de e-mail.',
  },
  email: {
    en: {
      button: { label: 'Confirm the address', link: 'link' },
      lines: ['Confirm the e-mail address of your MotorFix account.'],
      reason:
        'You get this e-mail because this address was given for a MotorFix account. If it was not you, ignore it.',
      subject: 'Confirm your e-mail address',
    },
    ro: {
      button: { label: 'Confirmă adresa', link: 'link' },
      lines: ['Confirmă adresa de e-mail a contului tău MotorFix.'],
      reason:
        'Primești acest e-mail pentru că adresa a fost dată pentru un cont MotorFix. Dacă nu ai fost tu, ignoră-l.',
      subject: 'Confirmă adresa de e-mail',
    },
  },
  example,
  values,
};

export const PASSWORD_RESET: Template = {
  audience: 'any',
  bell: {
    en: 'You asked to reset your password.',
    ro: 'Ai cerut resetarea parolei.',
  },
  email: {
    en: {
      button: { label: 'Choose a new password', link: 'link' },
      lines: ['Choose a new password for your MotorFix account.'],
      reason:
        'You get this e-mail because someone asked to reset the password of this MotorFix account. If it was not you, ignore it; your password stays the same.',
      subject: 'Reset your password',
    },
    ro: {
      button: { label: 'Alege o parolă nouă', link: 'link' },
      lines: ['Alege o parolă nouă pentru contul tău MotorFix.'],
      reason:
        'Primești acest e-mail pentru că cineva a cerut resetarea parolei acestui cont MotorFix. Dacă nu ai fost tu, ignoră-l; parola rămâne aceeași.',
      subject: 'Resetează parola',
    },
  },
  example,
  values,
};
