import type { Template } from '../templates';

// To a garage's owners, once an admin or the system decides its verification
// file. Each WhatsApp name is a template registered with Brevo. The note is
// the admin's own words, so it goes in the e-mail only, never a push or bell.

// The decisions an owner is told about, each with its own template. Typed
// unknown so .has() takes a raw payload value before anything narrows it.
export const DECISIONS: ReadonlySet<unknown> = new Set([
  'approved',
  'more_requested',
  'rejected',
]);

const REASONS = {
  en: {
    address: 'Address',
    documents: 'Documents',
    other: 'Other reason',
    photos: 'Photos',
    rar: 'RAR authorisation',
  },
  ro: {
    address: 'Adresă',
    documents: 'Documente',
    other: 'Alt motiv',
    photos: 'Fotografii',
    rar: 'Autorizație RAR',
  },
} as const;

// The owner-facing name of a stored reason code; any other code is `other`.
export function reasonLabel(code: string | null, language: string): string {
  const labels = language === 'en' ? REASONS.en : REASONS.ro;
  return code && Object.hasOwn(labels, code)
    ? labels[code as keyof typeof labels]
    : labels.other;
}

const REASON = {
  en: 'You get this e-mail because you own a garage on MotorFix; the verification result is always sent.',
  ro: 'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix; rezultatul verificării se trimite întotdeauna.',
};

const EXAMPLE_LINK = 'https://motorfix.example/app/garage';

export const VERIFICATION_APPROVED: Template = {
  audience: 'garage',
  bell: {
    en: 'Your garage is approved and on the map',
    ro: 'Service-ul tău e aprobat și pe hartă',
  },
  email: {
    en: {
      button: { label: 'Open your garage dashboard', link: 'link' },
      lines: [
        'Verification is done: your garage is approved and drivers can now find it on the map.',
        'Your public profile: {profile}',
      ],
      reason: REASON.en,
      subject: 'Your garage is approved and on the map',
    },
    ro: {
      button: { label: 'Deschide panoul service-ului', link: 'link' },
      lines: [
        'Verificarea s-a încheiat: service-ul tău e aprobat și șoferii îl găsesc acum pe hartă.',
        'Profilul tău public: {profile}',
      ],
      reason: REASON.ro,
      subject: 'Service-ul tău e aprobat și pe hartă',
    },
  },
  example: {
    link: EXAMPLE_LINK,
    profile: 'https://motorfix.example/ro/garages/atelier-dinamo',
  },
  push: {
    en: {
      body: 'Your garage is approved and on the map.',
      link: 'link',
      title: 'Garage approved',
    },
    ro: {
      body: 'Service-ul tău e aprobat și apare pe hartă.',
      link: 'link',
      title: 'Service aprobat',
    },
  },
  values: { link: 'link', profile: 'link' },
  whatsapp: {
    en: { name: 'motorfix_verification_approved_en', slots: ['{profile}'] },
    ro: { name: 'motorfix_verification_approved_ro', slots: ['{profile}'] },
  },
};

const NEGATIVE_EXAMPLE = {
  link: EXAMPLE_LINK,
  note: 'Pagina a doua a certificatului nu se citește.',
  reason: 'Documente',
};

export const VERIFICATION_MORE_REQUESTED: Template = {
  audience: 'garage',
  bell: {
    en: 'Verification: we need a bit more from you',
    ro: 'Verificare: mai avem nevoie de ceva de la tine',
  },
  email: {
    en: {
      button: { label: 'Complete your file', link: 'link' },
      lines: [
        "To finish your garage's verification we need a bit more.",
        'Reason: {reason}',
        'Note: {note}',
        'Your file is kept: you can complete it without starting over.',
      ],
      reason: REASON.en,
      subject: 'Verification: we need a bit more from you',
    },
    ro: {
      button: { label: 'Completează dosarul', link: 'link' },
      lines: [
        'Ca să încheiem verificarea service-ului, mai avem nevoie de ceva.',
        'Motiv: {reason}',
        'Nota: {note}',
        'Dosarul tău rămâne salvat: poți completa fără să o iei de la capăt.',
      ],
      reason: REASON.ro,
      subject: 'Verificare: mai avem nevoie de ceva de la tine',
    },
  },
  example: NEGATIVE_EXAMPLE,
  push: {
    en: {
      body: 'We need a bit more to verify your garage. Open your dashboard to see what.',
      link: 'link',
      title: 'Verification: more needed',
    },
    ro: {
      body: 'Mai avem nevoie de ceva ca să verificăm service-ul. Deschide panoul să vezi ce.',
      link: 'link',
      title: 'Verificare: mai trebuie ceva',
    },
  },
  values: { link: 'link', note: 'text', reason: 'text' },
  whatsapp: {
    en: {
      name: 'motorfix_verification_more_requested_en',
      slots: ['{reason}'],
    },
    ro: {
      name: 'motorfix_verification_more_requested_ro',
      slots: ['{reason}'],
    },
  },
};

export const VERIFICATION_REJECTED: Template = {
  audience: 'garage',
  bell: {
    en: 'Verification: your garage was not approved',
    ro: 'Verificare: service-ul nu a fost aprobat',
  },
  email: {
    en: {
      button: { label: 'Correct your listing', link: 'link' },
      lines: [
        'Your garage was not approved at verification.',
        'Reason: {reason}',
        'Note: {note}',
        'What next: you can correct the listing and send it again.',
      ],
      reason: REASON.en,
      subject: 'Verification: your garage was not approved',
    },
    ro: {
      button: { label: 'Corectează listarea', link: 'link' },
      lines: [
        'Service-ul tău nu a fost aprobat la verificare.',
        'Motiv: {reason}',
        'Nota: {note}',
        'Ce urmează: poți corecta listarea și o trimiți din nou.',
      ],
      reason: REASON.ro,
      subject: 'Verificare: service-ul nu a fost aprobat',
    },
  },
  example: NEGATIVE_EXAMPLE,
  push: {
    en: {
      body: 'Your garage was not approved. See the reason in your dashboard.',
      link: 'link',
      title: 'Verification: not approved',
    },
    ro: {
      body: 'Service-ul tău nu a fost aprobat. Vezi motivul în panou.',
      link: 'link',
      title: 'Verificare: neaprobat',
    },
  },
  values: { link: 'link', note: 'text', reason: 'text' },
  whatsapp: {
    en: { name: 'motorfix_verification_rejected_en', slots: ['{reason}'] },
    ro: { name: 'motorfix_verification_rejected_ro', slots: ['{reason}'] },
  },
};
