import type {
  DecisionRefusal,
  ReplyRefusal,
  ReportRefusal,
  ReviewRemovalReason,
  ReviewReportReason,
} from '@motor-fix/contracts';
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

// A reply posted or edited, or the code of a refusal; a 404 is not counted.
// Not started at 0, as the reports: the API's start set is at its series cap.
type ReviewRepliedOutcome =
  | 'published'
  | 'edited'
  | 'forbidden'
  | ReplyRefusal
  | 'validation_failed';

export function recordReviewReplied(outcome: ReviewRepliedOutcome) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_reviews_replied_total', {
      description: 'Replies garages tried to post or edit, by outcome',
    })
    .add(1, { outcome });
}

// A decision on a reported review or reply: removed with its target and rule,
// or the code of a refusal (no target or rule); a 404 is not counted.
export function recordReviewDecided(
  outcome: 'removed' | DecisionRefusal,
  target?: 'review' | 'reply',
  reason?: ReviewRemovalReason,
) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_review_decisions_total', {
      description: 'Admin decisions on reported reviews, by outcome',
    })
    .add(1, { outcome, ...(target && { target }), ...(reason && { reason }) });
}
