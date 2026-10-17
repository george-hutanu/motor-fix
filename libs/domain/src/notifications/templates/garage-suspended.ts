import type { Template } from '../templates';

// To a garage's owners, once MotorFix or an admin suspends the garage. The
// reason is MotorFix's own words, written for the owner, so it goes in every
// channel; the next step follows from the cause.

const NEXT = {
  en: {
    documents_overdue: 'upload the yearly documents.',
    recheck_failed: 'upload the renewed RAR authorisation.',
    team: 'answer the MotorFix team.',
  },
  ro: {
    documents_overdue: 'încarcă documentele anuale.',
    recheck_failed: 'încarcă autorizația RAR reînnoită.',
    team: 'răspunde echipei MotorFix.',
  },
} as const;

// What the owner does to lift the suspension: renew the authorisation, send
// the yearly documents, or, for an admin's or a report's decision, answer
// the team.
export function nextStep(cause: string, language: string): string {
  const steps = language === 'en' ? NEXT.en : NEXT.ro;
  if (cause === 'recheck_failed' || cause === 'documents_overdue') {
    return steps[cause];
  }
  return steps.team;
}

const REASON = {
  en: 'You get this e-mail because you own a garage on MotorFix; a suspension notice is always sent.',
  ro: 'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; anunțul de suspendare se trimite întotdeauna.',
};

export const GARAGE_SUSPENDED: Template = {
  audience: 'garage',
  bell: {
    en: '{garage} was suspended: {reason}',
    ro: '{garage} a fost suspendat: {reason}',
  },
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'link' },
      lines: [
        'The {garage} profile is off the map until this is fixed, and drivers cannot send it new requests.',
        'Reason: {reason}',
        'What next: {next}',
      ],
      reason: REASON.en,
      subject: 'The {garage} profile was suspended',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'link' },
      lines: [
        'Profilul {garage} nu apare pe hartă până se rezolvă, iar șoferii nu îi mai pot trimite cereri noi.',
        'Motiv: {reason}',
        'Ce urmează: {next}',
      ],
      reason: REASON.ro,
      subject: 'Profilul {garage} a fost suspendat',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/garage',
    next: NEXT.ro.recheck_failed,
    reason: 'Autorizație RAR expirată pe 12 sept. 2026',
  },
  push: {
    en: {
      body: '{garage} is off the map until this is fixed: {reason}',
      link: 'link',
      title: 'Garage suspended',
    },
    ro: {
      body: '{garage} nu apare pe hartă până se rezolvă: {reason}',
      link: 'link',
      title: 'Service suspendat',
    },
  },
  values: { garage: 'text', link: 'link', next: 'text', reason: 'text' },
  whatsapp: {
    en: { name: 'motorfix_garage_suspended_en', slots: ['{reason}'] },
    ro: { name: 'motorfix_garage_suspended_ro', slots: ['{reason}'] },
  },
};
