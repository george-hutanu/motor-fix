import {
  REVIEW_REPORT_TEXT_MAX,
  type ReportRefusal,
  type ReviewReportReason,
} from '@motor-fix/contracts';

import type { ReviewStatus } from '../../generated/prisma/enums';

// An admin's decision on the review stands until its author edits it; the
// decision itself (kept, or removed and restored) does not matter. A tie is
// kept.
const keptBy = (
  review: { editedAt: Date | null },
  newestDecided: { decidedAt: Date | null } | null,
) =>
  newestDecided?.decidedAt != null &&
  (review.editedAt === null || review.editedAt <= newestDecided.decidedAt);

// Why the garage may not report the review, or null when it may. Read from the
// rows alone, so the button and the operation answer alike.
export function reportRefusalOf(
  review: { status: ReviewStatus; editedAt: Date | null },
  newestDecided: { decidedAt: Date | null } | null,
): ReportRefusal | null {
  if (review.status === 'reported') return 'already_reported';
  if (review.status === 'published' && keptBy(review, newestDecided)) {
    return 'already_kept';
  }
  return null;
}

// What is wrong with the text for the reason, or null: only "other" takes
// one, of 1 to the cap in characters after the trim.
export function textProblemOf(
  reason: ReviewReportReason,
  text: string | undefined,
): 'required' | 'length' | 'not_allowed' | null {
  const trimmed = text?.trim() ?? '';
  if (reason !== 'other') return trimmed ? 'not_allowed' : null;
  if (!trimmed) return 'required';
  return [...trimmed].length > REVIEW_REPORT_TEXT_MAX ? 'length' : null;
}
