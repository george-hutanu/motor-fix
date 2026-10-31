import type { Template } from '../templates';

// An admin removed a reported review, or the garage's reply to one: one form
// for each target and side, named by the param variant. Every form names the
// rule broken and never who reported it; only the author of a removed review
// is told about the appeal. Each WhatsApp name is a template registered with
// Brevo.

export const REVIEW_DECIDED_VARIANTS = [
  'review_author',
  'review_owner',
  'reply_owner',
  'reply_author',
] as const;
export type ReviewDecidedVariant = (typeof REVIEW_DECIDED_VARIANTS)[number];

const VALUES = {
  author: 'text',
  garage: 'text',
  link: 'link',
  rule: 'report_reason',
} as const;

const EXAMPLE = {
  author: 'Andrei M.',
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.example/app/driver/reviews',
  rule: 'insults',
};

const REASON = {
  driver: {
    en: 'You get this e-mail because you reviewed a garage on MotorFix.',
    ro: 'Primești acest e-mail pentru că ai lăsat o recenzie unui service pe MotorFix.',
  },
  garage: {
    en: 'You get this e-mail because you own a garage on MotorFix.',
    ro: 'Primești acest e-mail pentru că deții un service pe MotorFix.',
  },
};

const BUTTON = {
  en: { label: 'See the reviews', link: 'link' },
  ro: { label: 'Vezi recenziile', link: 'link' },
};

interface Words {
  line: { en: string; ro: string };
  title: { en: string; ro: string };
  // The appeal, for the author of a removed review alone.
  appeal?: { en: string; ro: string };
}

function form(
  audience: 'driver' | 'garage',
  variant: ReviewDecidedVariant,
  { appeal, line, title }: Words,
): Template {
  const whole = (language: 'en' | 'ro') =>
    appeal ? `${line[language]} ${appeal[language]}` : line[language];
  const lines = (language: 'en' | 'ro') =>
    appeal ? [line[language], appeal[language]] : [line[language]];
  const slots =
    audience === 'driver' ? ['{garage}', '{rule}'] : ['{author}', '{rule}'];
  return {
    audience,
    bell: { en: whole('en'), ro: whole('ro') },
    email: {
      en: {
        button: BUTTON.en,
        lines: lines('en'),
        reason: REASON[audience].en,
        subject: title.en,
      },
      ro: {
        button: BUTTON.ro,
        lines: lines('ro'),
        reason: REASON[audience].ro,
        subject: title.ro,
      },
    },
    example: EXAMPLE,
    push: {
      en: { body: whole('en'), link: 'link', title: title.en },
      ro: { body: whole('ro'), link: 'link', title: title.ro },
    },
    values: VALUES,
    whatsapp: {
      en: { name: `motorfix_review_decided_${variant}_en`, slots },
      ro: { name: `motorfix_review_decided_${variant}_ro`, slots },
    },
  };
}

const REVIEW_TITLE = {
  en: 'A review was removed',
  ro: 'O recenzie a fost ștearsă',
};
const REPLY_TITLE = {
  en: 'A reply was removed',
  ro: 'Un răspuns a fost șters',
};

export const REVIEW_DECIDED_FORMS: Record<ReviewDecidedVariant, Template> = {
  reply_author: form('driver', 'reply_author', {
    line: {
      en: "{garage}'s reply to your review was removed: {rule}.",
      ro: 'Răspunsul service-ului {garage} la recenzia ta a fost șters: {rule}.',
    },
    title: REPLY_TITLE,
  }),
  reply_owner: form('garage', 'reply_owner', {
    line: {
      en: "MotorFix removed your reply to {author}'s review: {rule}.",
      ro: 'MotorFix a șters răspunsul tău la recenzia lui {author}: {rule}.',
    },
    title: REPLY_TITLE,
  }),
  review_author: form('driver', 'review_author', {
    appeal: {
      en: 'You can appeal once, within 14 days.',
      ro: 'Poți contesta o dată, în 14 zile.',
    },
    line: {
      en: 'MotorFix removed your review of {garage}: {rule}.',
      ro: 'MotorFix a șters recenzia ta pentru {garage}: {rule}.',
    },
    title: { en: 'Your review was removed', ro: 'Recenzia ta a fost ștearsă' },
  }),
  review_owner: form('garage', 'review_owner', {
    line: {
      en: "{author}'s review was removed: {rule}.",
      ro: 'Recenzia lui {author} a fost ștearsă: {rule}.',
    },
    title: REVIEW_TITLE,
  }),
};
