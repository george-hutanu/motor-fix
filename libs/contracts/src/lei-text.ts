// An amount in lei as a Romanian driver types it, and the review limits and
// texts the browser shares with the server, kept here because the browser
// imports this file and not the validators.
export const PAID_BANI_MAX = 100_000_000;
// The drawer counts against the same limit the server checks.
export const REVIEW_TEXT_MAX = 2000;
// The "something else" text of a review report, in characters after the trim.
export const REVIEW_REPORT_TEXT_MAX = 500;
// The reasons a garage may report a review for, in the order the task lists
// them.
export const REVIEW_REPORT_REASONS = [
  'insults',
  'personal_data',
  'ads',
  'promotion',
  'off_topic',
  'hate',
  'fake_or_conflicted',
  'threats_or_legal_accusations',
  'other',
] as const;
// A garage's reply to a review, in characters after the trim; the dialog
// counts against the same limit.
export const REVIEW_REPLY_TEXT_MAX = 1000;
// How a review whose author deleted the account is signed; the profile shows
// it in the reader's language.
export const DELETED_AUTHOR = 'Șofer MotorFix';

type LeiText =
  | { bani: number }
  | { error: 'decimals' | 'format' | 'max' | 'min' };

const AMOUNT = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

// "4.200,50 lei" is 420050 bani: a dot groups thousands, a comma starts bani.
export function parseLeiText(text: string): LeiText {
  const amount = AMOUNT.exec(text.replace(/\s+/g, '').replace(/lei$/i, ''));
  if (!amount) return { error: 'format' };
  const [, minus, lei, bani = ''] = amount;
  if (bani.length > 2) return { error: 'decimals' };
  const value =
    Number(lei.replaceAll('.', '')) * 100 + Number(bani.padEnd(2, '0'));
  if (minus || value === 0) return { error: 'min' };
  if (value > PAID_BANI_MAX) return { error: 'max' };
  return { bani: value };
}
