import { mediaConfig } from '@motor-fix/contracts';

// How long the product keeps each kind of data, as the privacy notice states
// it: the owner's decision T10 of 2026-10-16. Every sweep reads its period
// here, at call time; nothing else in the product states these numbers.
export const RETENTION_DECIDED = 'T10, 2026-10-16';

export const RETENTION = {
  // 5 years (5 × 365 + 1 days) from the garage's closure or the account's deletion.
  auditHistory: {
    covers:
      'audit history entries, anonymised once their owner has been closed this long',
    days: 1826,
  },
  daySheetPdfs: {
    covers: 'day-sheet PDFs',
    days: 30,
  },
  legalDocuments: {
    covers:
      "a garage's legal documents and their page files, from the garage's closure",
    days: 1826,
  },
  // MEDIA_RETENTION_DAYS, 90 by default: the media purge and the items
  // sent read the same value.
  media: {
    covers: 'job photos, clips, recordings, request and reply photos',
    get days() {
      return mediaConfig().retentionDays;
    },
  },
  notifications: {
    covers: 'notifications of every channel and status, from their creation',
    days: 365,
  },
} as const;

// The most rows one statement of a sweep touches.
export const RETENTION_BATCH = 1000;

// The actor name an anonymised audit entry holds; the database admits no other.
export const ANONYMISED = 'anonymised';

// What the nightly run sweeps, in its order.
export const RETENTION_KINDS = [
  'sign_in_code',
  'phone_change',
  'account_token',
  'refresh_token',
  'staff_invite',
  'notification',
  'legal_document',
  'audit_entry',
] as const;

export type RetentionKind = (typeof RETENTION_KINDS)[number];

const DAY_MS = 86_400_000;

// A row older than this is due: compared strictly, so a row exactly the
// period old stays.
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
