import type { Template } from '../templates';

// A review or a reply was reported, or a review was flagged automatically,
// and after 48 hours a reminder that the report still waits. Every form
// opens the admins' review queue; none carries the review's text.
const VALUES = {
  author: 'text',
  garage: 'text',
  link: 'link',
  reason: 'report_reason',
  score: 'score',
} as const;

const EXAMPLE = {
  author: 'Andrei M.',
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.example/app/admin/reviews',
  reason: 'insults',
  score: 1,
};

const REASON = {
  en: 'You get this e-mail because you are a MotorFix admin and reported reviews wait for a decision.',
  ro: 'Primești acest e-mail pentru că ești administrator MotorFix și recenziile raportate așteaptă o decizie.',
};

const BUTTON = {
  en: { label: 'Open the reported reviews', link: 'link' },
  ro: { label: 'Deschide recenziile raportate', link: 'link' },
};

// One form: its line in both languages, and the subject and push title.
function form(
  line: { en: string; ro: string },
  title: { en: string; ro: string },
  extra: { en?: string; ro?: string } = {},
): Template {
  const lines = (language: 'en' | 'ro') =>
    extra[language] ? [line[language], extra[language]] : [line[language]];
  return {
    audience: 'admin',
    bell: line,
    email: {
      en: {
        button: BUTTON.en,
        lines: lines('en'),
        reason: REASON.en,
        subject: title.en,
      },
      ro: {
        button: BUTTON.ro,
        lines: lines('ro'),
        reason: REASON.ro,
        subject: title.ro,
      },
    },
    example: EXAMPLE,
    push: {
      en: { body: line.en, link: 'link', title: title.en },
      ro: { body: line.ro, link: 'link', title: title.ro },
    },
    values: VALUES,
  };
}

const REVIEW_TITLE = {
  en: '{garage} · {score} review',
  ro: '{garage} · recenzie de {score}',
};

export const ADMIN_REVIEW_REPORTED_TEMPLATES: Record<string, Template> = {
  ADMIN_REVIEW_REPORTED: form(
    {
      en: '{garage} reported a {score} review: {reason}',
      ro: '{garage} a raportat o recenzie de {score}: {reason}',
    },
    { en: 'A review was reported', ro: 'O recenzie a fost raportată' },
  ),
  'ADMIN_REVIEW_REPORTED.automatic': form(
    {
      en: 'A {score} review was flagged automatically: {reason}',
      ro: 'O recenzie de {score} a fost raportată automat: {reason}',
    },
    REVIEW_TITLE,
  ),
  'ADMIN_REVIEW_REPORTED.reminder': form(
    {
      en: 'A reported review has waited 48 hours.',
      ro: 'O recenzie raportată așteaptă de 48 de ore.',
    },
    REVIEW_TITLE,
    REVIEW_TITLE,
  ),
  'ADMIN_REVIEW_REPORTED.reply': form(
    {
      en: "{author} reported {garage}'s reply: {reason}",
      ro: '{author} a raportat răspunsul lui {garage}: {reason}',
    },
    { en: 'A reply was reported', ro: 'Un răspuns a fost raportat' },
  ),
};
