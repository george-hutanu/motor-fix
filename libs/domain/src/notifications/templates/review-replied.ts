import type { Template } from '../templates';

// To a review's author, as the garage answers the review in public. Each
// WhatsApp name is a template registered with Brevo. An edit sends nothing.
export const REVIEW_REPLIED: Template = {
  audience: 'driver',
  bell: {
    en: '{garage} replied to your review.',
    ro: '{garage} ți-a răspuns la recenzie.',
  },
  email: {
    en: {
      button: { label: 'See your reviews', link: 'link' },
      lines: ['{garage} answered your review in public, under it.'],
      reason: 'You get this e-mail because you reviewed a garage on MotorFix.',
      subject: '{garage} replied to your review.',
    },
    ro: {
      button: { label: 'Vezi recenziile tale', link: 'link' },
      lines: ['{garage} ți-a răspuns public, sub recenzie.'],
      reason:
        'Primești acest e-mail pentru că ai lăsat o recenzie unui service pe MotorFix.',
      subject: '{garage} ți-a răspuns la recenzie.',
    },
  },
  example: {
    garage: 'Atelier Dinamo',
    link: 'https://motorfix.example/app/driver/reviews',
  },
  push: {
    en: {
      body: '{garage} replied to your review.',
      link: 'link',
      title: 'Reply to your review',
    },
    ro: {
      body: '{garage} ți-a răspuns la recenzie.',
      link: 'link',
      title: 'Răspuns la recenzie',
    },
  },
  values: { garage: 'text', link: 'link' },
  whatsapp: {
    en: { name: 'motorfix_review_replied_en', slots: ['{garage}'] },
    ro: { name: 'motorfix_review_replied_ro', slots: ['{garage}'] },
  },
};
