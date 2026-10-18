import type { Template } from '../templates';

// To each driver who reported a garage, once an admin decides the reports:
// one variant per decision. Only the garage's name and its public profile go
// out, never the admin's note or the reason the garage was given.

// The decisions a reporter is told about, each with its own template. Typed
// unknown so .has() takes a raw payload value before anything narrows it.
export const REPORT_DECISIONS: ReadonlySet<unknown> = new Set([
  'unfounded',
  'confirmed',
]);

const REASON = {
  en: 'You get this e-mail because you reported a garage on MotorFix.',
  ro: 'Primești acest e-mail pentru că ai semnalat un service pe MotorFix.',
};

const BUTTON = {
  en: { label: 'See the garage', link: 'profile' },
  ro: { label: 'Vezi service-ul', link: 'profile' },
};

const EXAMPLE = {
  garage: 'Atelier Dinamo',
  profile: 'https://motorfix.example/ro/garages/atelier-dinamo',
};

const VALUES = { garage: 'text', profile: 'link' } as const;

function decided(words: { en: string; ro: string }): Template {
  return {
    audience: 'driver',
    bell: words,
    email: {
      en: {
        button: BUTTON.en,
        lines: [words.en],
        reason: REASON.en,
        subject: 'About your report on {garage}',
      },
      ro: {
        button: BUTTON.ro,
        lines: [words.ro],
        reason: REASON.ro,
        subject: 'Despre sesizarea ta privind {garage}',
      },
    },
    example: EXAMPLE,
    push: {
      en: { body: words.en, link: 'profile', title: 'Your report' },
      ro: { body: words.ro, link: 'profile', title: 'Sesizarea ta' },
    },
    values: VALUES,
  };
}

export const GARAGE_REPORT_UNFOUNDED = decided({
  en: 'We checked your report about {garage}. No action was needed.',
  ro: 'Am verificat sesizarea ta despre {garage}. Nu a fost nevoie de nicio măsură.',
});

export const GARAGE_REPORT_CONFIRMED = decided({
  en: 'We checked your report about {garage} and took action.',
  ro: 'Am verificat sesizarea ta despre {garage} și am luat măsuri.',
});
