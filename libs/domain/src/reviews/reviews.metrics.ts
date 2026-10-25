import type { ReportRefusal, ReviewReportReason } from '@motor-fix/contracts';
import { metrics } from '@opentelemetry/api';

export const REVIEW_POSTED_OUTCOMES = [
  'published',
  'job_not_done',
  'own_garage',
  'already_reviewed',
  'review_removed',
  'email_not_confirmed',
] as const;
type ReviewPostedOutcome = (typeof REVIEW_POSTED_OUTCOMES)[number];

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
export const reviewsPosted = () =>
  metrics.getMeter('motorfix').createCounter('motorfix_reviews_posted_total', {
    description: 'Reviews drivers tried to publish, by outcome',
  });

export function recordReviewPosted(outcome: ReviewPostedOutcome) {
  reviewsPosted().add(1, { outcome });
}

// The reason of an accepted report, or the code of a refusal; a 404 is not
// counted. Not started at 0: the API's start set is at its series cap.
type ReviewReportedOutcome =
  | ReviewReportReason
  | 'forbidden'
  | ReportRefusal
  | 'validation_failed';

export function recordReviewReported(outcome: ReviewReportedOutcome) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_reviews_reported_total', {
      description: 'Reviews garages tried to report, by reason or refusal',
    })
    .add(1, { outcome });
}
