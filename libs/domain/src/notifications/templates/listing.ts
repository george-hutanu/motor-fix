import type { Template } from '../templates';

// A draft has no account: these go to the address left on the form, in the
// draft's language, with the link as their only value.
const listing = (
  ro: { button: string; lines: string[]; subject: string },
  en: { button: string; lines: string[]; subject: string },
): Template => ({
  audience: 'any',
  email: {
    en: {
      button: { label: en.button, link: 'link' },
      lines: en.lines,
      reason:
        'You get this e-mail because this address was given while listing a garage on MotorFix. If it was not you, ignore it.',
      subject: en.subject,
    },
    ro: {
      button: { label: ro.button, link: 'link' },
      lines: ro.lines,
      reason:
        'Primești acest e-mail pentru că ai început să înscrii un service pe MotorFix cu această adresă. Dacă nu ai fost tu, ignoră-l.',
      subject: ro.subject,
    },
  },
  example: {
    link: 'https://motorfix.example/ro/list-your-garage?draft=example',
  },
  values: { link: 'link' },
});

export const LISTING_CONTINUE_LINK = listing(
  {
    button: 'Continuă înscrierea',
    lines: [
      'Ciorna service-ului tău e salvată.',
      'Deschide linkul pe orice dispozitiv ca să continui de unde ai rămas.',
    ],
    subject: 'Continuă înscrierea service-ului',
  },
  {
    button: 'Continue listing',
    lines: [
      "Your garage's draft is saved.",
      'Open the link on any device to continue where you left off.',
    ],
    subject: 'Continue listing your garage',
  },
);

export const LISTING_REMINDER = listing(
  {
    button: 'Continuă de unde ai rămas',
    lines: [
      'Ai început să înscrii service-ul pe MotorFix și ciorna te așteaptă.',
      'Termină înscrierea ca șoferii din zonă să te poată găsi.',
    ],
    subject: 'Ai început să-ți înscrii service-ul',
  },
  {
    button: 'Pick up where you left off',
    lines: [
      'You started listing your garage on MotorFix and your draft is waiting.',
      'Finish the listing so drivers nearby can find you.',
    ],
    subject: 'You started listing your garage',
  },
);
