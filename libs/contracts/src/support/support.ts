// The contact form's rules, browser-safe, so the web form checks the same
// ranges the API refuses.
export const SUPPORT_TOPICS = [
  'request_or_booking',
  'account',
  'reviews',
  'listing',
  'other',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_NAME_MAX = 80;
export const SUPPORT_EMAIL_MAX = 254;
export const SUPPORT_MESSAGE_MIN = 20;
export const SUPPORT_MESSAGE_MAX = 2000;
export const SUPPORT_SUBJECT_REF_MAX = 40;

// MF, the Bucharest year, and the year's count padded to six digits.
export const supportReference = (year: number, n: number) =>
  `MF-${year}-${String(n).padStart(6, '0')}`;
