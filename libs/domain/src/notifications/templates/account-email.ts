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

// After a reset: the button opens MotorFix, where the holder can reset again.
export const PASSWORD_CHANGED: Template = {
  audience: 'any',
  bell: {
    en: 'Your password was changed.',
    ro: 'Parola ta a fost schimbată.',
  },
  email: {
    en: {
      button: { label: 'Sign in', link: 'link' },
      lines: ['The password of your MotorFix account was changed.'],
      reason:
        'You get this e-mail because the password of this MotorFix account was changed. If it was not you, reset your password now from the sign-in screen.',
      subject: 'Your password was changed',
    },
    ro: {
      button: { label: 'Intră în cont', link: 'link' },
      lines: ['Parola contului tău MotorFix a fost schimbată.'],
      reason:
        'Primești acest e-mail pentru că parola acestui cont MotorFix a fost schimbată. Dacă nu ai fost tu, resetează parola acum din ecranul de autentificare.',
      subject: 'Parola ta a fost schimbată',
    },
  },
  example,
  values,
};

// To the old address when a new one is asked for; the button opens MotorFix,
// where the holder can change the password, which ends the other sessions.
export const EMAIL_CHANGE_NOTICE: Template = {
  audience: 'any',
  bell: {
    en: 'A new e-mail address was asked for your account.',
    ro: 'S-a cerut o adresă de e-mail nouă pentru contul tău.',
  },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'link' },
      lines: [
        'Someone asked to change the e-mail address of your MotorFix account. It changes only once the link sent to the new address is opened.',
      ],
      reason:
        'You get this e-mail because it is the address of this MotorFix account. If it was not you, change your password now.',
      subject: 'A new e-mail address was asked for your account',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'link' },
      lines: [
        'Cineva a cerut schimbarea adresei de e-mail a contului tău MotorFix. Adresa se schimbă doar după ce se deschide linkul trimis la adresa nouă.',
      ],
      reason:
        'Primești acest e-mail pentru că este adresa acestui cont MotorFix. Dacă nu ai fost tu, schimbă parola acum.',
      subject: 'S-a cerut o adresă de e-mail nouă pentru contul tău',
    },
  },
  example,
  values,
};

// Sent to the address the account held, after the account is deleted; the
// button opens MotorFix's Home.
export const ACCOUNT_DELETED: Template = {
  audience: 'any',
  bell: {
    en: 'Your account was deleted.',
    ro: 'Contul tău a fost șters.',
  },
  email: {
    en: {
      button: { label: 'Open MotorFix', link: 'link' },
      lines: [
        'Your MotorFix account was deleted. Your personal details were removed and you can no longer sign in with it.',
      ],
      reason:
        'You get this e-mail because it was the address of this MotorFix account. If it was not you, write to us through the contact form.',
      subject: 'Your account was deleted',
    },
    ro: {
      button: { label: 'Deschide MotorFix', link: 'link' },
      lines: [
        'Contul tău MotorFix a fost șters. Datele tale personale au fost eliminate și nu mai poți intra în cont.',
      ],
      reason:
        'Primești acest e-mail pentru că aceasta era adresa contului MotorFix. Dacă nu ai fost tu, scrie-ne prin formularul de contact.',
      subject: 'Contul tău a fost șters',
    },
  },
  example: { link: 'https://motorfix.example/ro' },
  values,
};

// An admin suspended the account: the reason as they wrote it, and where to
// write to have it looked at again.
export const ACCOUNT_SUSPENDED: Template = {
  audience: 'any',
  bell: {
    en: 'Your account was suspended.',
    ro: 'Contul tău a fost suspendat.',
  },
  email: {
    en: {
      button: { label: 'Write to us', link: 'link' },
      lines: [
        'Your MotorFix account was suspended and you cannot sign in to it for now.',
        'The reason: {reason}',
        'If you think this is a mistake, write to us: {support}',
      ],
      reason:
        'You get this e-mail because it is the address of this MotorFix account.',
      subject: 'Your account was suspended',
    },
    ro: {
      button: { label: 'Scrie-ne', link: 'link' },
      lines: [
        'Contul tău MotorFix a fost suspendat și deocamdată nu poți intra în el.',
        'Motivul: {reason}',
        'Dacă crezi că e o greșeală, scrie-ne: {support}',
      ],
      reason:
        'Primești acest e-mail pentru că aceasta este adresa contului MotorFix.',
      subject: 'Contul tău a fost suspendat',
    },
  },
  example: {
    link: 'https://motorfix.example/ro/contact',
    reason: 'Cereri false repetate către service-uri.',
    support: 'suport@example.test',
  },
  values: { link: 'link', reason: 'text', support: 'text' },
};

// The same e-mail when no support address is set: the button to the contact
// page is the way to write, so no address is named.
export const ACCOUNT_SUSPENDED_CONTACT: Template = {
  audience: 'any',
  bell: ACCOUNT_SUSPENDED.bell,
  email: {
    en: {
      button: { label: 'Write to us', link: 'link' },
      lines: [
        'Your MotorFix account was suspended and you cannot sign in to it for now.',
        'The reason: {reason}',
        'If you think this is a mistake, write to us with the button below.',
      ],
      reason:
        'You get this e-mail because it is the address of this MotorFix account.',
      subject: 'Your account was suspended',
    },
    ro: {
      button: { label: 'Scrie-ne', link: 'link' },
      lines: [
        'Contul tău MotorFix a fost suspendat și deocamdată nu poți intra în el.',
        'Motivul: {reason}',
        'Dacă crezi că e o greșeală, scrie-ne prin butonul de mai jos.',
      ],
      reason:
        'Primești acest e-mail pentru că aceasta este adresa contului MotorFix.',
      subject: 'Contul tău a fost suspendat',
    },
  },
  example: {
    link: 'https://motorfix.example/ro/contact',
    reason: 'Cereri false repetate către service-uri.',
  },
  values: { link: 'link', reason: 'text' },
};
