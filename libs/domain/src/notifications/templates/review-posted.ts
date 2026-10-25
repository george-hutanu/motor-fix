import type { Template } from '../templates';

// To a garage's owners, as a driver's review of the garage is posted.
// `source` picks the text: a profile review names no car. The author's short
// name ends in a full stop, so no line ends in a second one. Each WhatsApp
// name is a template registered with Brevo.
const email = (car: boolean): Template['email'] => ({
  en: {
    button: { label: 'Open the reviews', link: 'link' },
    lines: [
      car
        ? '{author} gave your garage {rating} stars for a {car}.'
        : '{author} gave your garage {rating} stars.',
    ],
    reason:
      'You get this e‑mail because you own a garage on MotorFix and follow its reviews.',
    subject: car ? 'New review: {car}' : 'New review',
  },
  ro: {
    button: { label: 'Deschide recenziile', link: 'link' },
    lines: [
      car
        ? '{author} a dat service‑ului tău nota {rating} pentru {car}.'
        : '{author} a dat service‑ului tău nota {rating}.',
    ],
    reason:
      'Primești acest e‑mail pentru că deții un service pe MotorFix și îi urmărești recenziile.',
    subject: car ? 'Recenzie nouă: {car}' : 'Recenzie nouă',
  },
});

const JOB_RO = 'Recenzie nouă de {rating} de la {author} pentru {car}';
const JOB_EN = 'New {rating}-star review from {author} for a {car}';
const PROFILE_RO = 'Recenzie nouă de {rating} de la {author}';
const PROFILE_EN = 'New {rating}-star review from {author}';

export const REVIEW_POSTED_JOB: Template = {
  audience: 'garage',
  bell: { en: JOB_EN, ro: JOB_RO },
  email: email(true),
  example: {
    author: 'Andrei M.',
    car: 'BMW 320d',
    link: 'https://motorfix.example/app/garage/reviews',
    rating: 5,
  },
  push: {
    en: { body: JOB_EN, link: 'link', title: 'New review' },
    ro: { body: JOB_RO, link: 'link', title: 'Recenzie nouă' },
  },
  values: { author: 'text', car: 'text', link: 'link', rating: 'num' },
  whatsapp: {
    en: {
      name: 'motorfix_review_posted_job_en',
      slots: ['{rating}', '{author}', '{car}'],
    },
    ro: {
      name: 'motorfix_review_posted_job_ro',
      slots: ['{rating}', '{author}', '{car}'],
    },
  },
};

export const REVIEW_POSTED_PROFILE: Template = {
  audience: 'garage',
  bell: { en: PROFILE_EN, ro: PROFILE_RO },
  email: email(false),
  example: {
    author: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/reviews',
    rating: 5,
  },
  push: {
    en: { body: PROFILE_EN, link: 'link', title: 'New review' },
    ro: { body: PROFILE_RO, link: 'link', title: 'Recenzie nouă' },
  },
  values: { author: 'text', link: 'link', rating: 'num' },
  whatsapp: {
    en: {
      name: 'motorfix_review_posted_profile_en',
      slots: ['{rating}', '{author}'],
    },
    ro: {
      name: 'motorfix_review_posted_profile_ro',
      slots: ['{rating}', '{author}'],
    },
  },
};
