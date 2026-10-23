import type { Template } from '../templates';

// To the owner of the garage that proposed a job, once an admin decides it:
// one variant per decision. The reason is the admin's, shown as plain text;
// the push leaves it out, as it may run to 500 characters, and shortens the
// job's name with "…" to fit its 120.

const REASON = {
  en: 'You get this e-mail because you own a garage on MotorFix and proposed a job for the catalogue.',
  ro: 'Primești acest e-mail pentru că ești proprietarul unui service pe MotorFix și ai propus o lucrare pentru catalog.',
};

const BUTTON = {
  en: { label: 'Open Prices', link: 'prices' },
  ro: { label: 'Deschide Prețuri', link: 'prices' },
};

const EXAMPLE = {
  job: 'Recondiționare injectoare',
  prices: 'https://motorfix.example/app/garage/prices',
};

type Words = { en: string; ro: string };

function decided(
  words: Words,
  subject: Words,
  push: { body: Words; title: Words },
  reason?: string,
): Template {
  const language = (code: 'en' | 'ro') => ({
    button: BUTTON[code],
    lines: [words[code]],
    reason: REASON[code],
    subject: subject[code],
  });
  return {
    audience: 'garage',
    bell: words,
    email: { en: language('en'), ro: language('ro') },
    example: reason ? { ...EXAMPLE, reason } : EXAMPLE,
    push: {
      en: {
        body: push.body.en,
        link: 'prices',
        shorten: 'job',
        title: push.title.en,
      },
      ro: {
        body: push.body.ro,
        link: 'prices',
        shorten: 'job',
        title: push.title.ro,
      },
    },
    values: reason
      ? { job: 'text', prices: 'link', reason: 'text' }
      : { job: 'text', prices: 'link' },
  };
}

export const CATALOGUE_JOB_APPROVED = decided(
  {
    en: 'The job "{job}" was approved and is on your profile.',
    ro: 'Lucrarea „{job}” a fost aprobată și apare pe profilul tău.',
  },
  { en: 'The job {job} was approved', ro: 'Lucrarea {job} a fost aprobată' },
  {
    body: {
      en: '"{job}" is now on your profile.',
      ro: '„{job}” e acum pe profilul tău.',
    },
    title: { en: 'Job approved', ro: 'Lucrare aprobată' },
  },
);

export const CATALOGUE_JOB_REJECTED = decided(
  {
    en: 'The job "{job}" was rejected: {reason}',
    ro: 'Lucrarea „{job}” a fost respinsă: {reason}',
  },
  { en: 'The job {job} was rejected', ro: 'Lucrarea {job} a fost respinsă' },
  {
    body: {
      en: '"{job}": the reason is in Prices.',
      ro: '„{job}”: motivul e în Prețuri.',
    },
    title: { en: 'Job rejected', ro: 'Lucrare respinsă' },
  },
  'Există deja în catalog ca „Curățare injectoare”.',
);
